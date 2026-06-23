import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  IntegrationAdapter,
  IntegrationKind,
} from "../integration-adapter.interface";
import { verifyHmacHex } from "../sig-verify";

/**
 * Migros Yemek (Migros Hemen / Migros partner API) — REAL adapter.
 *
 * There was no Migros adapter in the integration-gateway before; this is the
 * first one. Migros authenticates with a per-store API key sent as a header
 * (no token exchange / refresh), scoped to a restaurant/store id. Documented
 * endpoints used here:
 *   - GET /yemek/restaurants/:storeId/orders?status=NEW (pull new orders)
 *   - PUT /yemek/orders/:orderId/status (accept / reject / status push)
 *   - PUT /yemek/restaurants/:storeId/products/:productId/status
 *         (open / close a product)
 *   - PUT /yemek/restaurants/:storeId/status (open / close the store)
 * Webhook signature: HMAC-SHA256(rawBody, webhookSecret), hex, `x-migros-hmac`.
 *
 * Registers under `migros_yemek`. Credentials come from init(config); nothing
 * is hardcoded. Status pushes are idempotent (re-sending a status is a no-op).
 */

const MIGROS_DEFAULT_BASE_URL = "https://partner-api.migros.com.tr";
const HTTP_TIMEOUT_MS = 10_000;

interface MigrosConfig {
  apiKey?: string;
  storeId?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

interface MigrosIntegrationEvent {
  providerId: string;
  type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class MigrosYemekLiveAdapter implements IntegrationAdapter {
  readonly id = "migros_yemek";
  readonly kind: IntegrationKind = "delivery";
  readonly configSchema = {
    type: "object",
    required: ["apiKey", "storeId"],
    properties: {
      apiKey: { type: "string", description: "Migros partner API key" },
      storeId: { type: "string", description: "Migros restaurant/store id" },
      webhookSecret: { type: "string", description: "Webhook signing secret" },
      baseUrl: { type: "string", description: "Override API base URL" },
    },
  };

  private readonly logger = new Logger(MigrosYemekLiveAdapter.name);
  private cfg: MigrosConfig = {};

  async init(config: MigrosConfig): Promise<void> {
    this.cfg = config ?? {};
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    const configured = Boolean(this.cfg.apiKey && this.cfg.storeId);
    if (!configured) {
      return { ok: false, details: { configured } };
    }
    try {
      await this.httpRequest("GET", `/yemek/restaurants/${this.cfg.storeId}`);
      return { ok: true, details: { configured } };
    } catch (err) {
      return {
        ok: false,
        details: { configured, error: (err as Error).message },
      };
    }
  }

  // -- Webhook verification ---------------------------------------------

  async parseWebhook(
    signature: string,
    raw: Buffer | string,
  ): Promise<MigrosIntegrationEvent[]> {
    const body = typeof raw === "string" ? raw : raw.toString("utf8");
    if (!this.cfg.webhookSecret) {
      throw new Error("migros: webhook secret not configured");
    }
    const expected = createHmac("sha256", this.cfg.webhookSecret)
      .update(body)
      .digest("hex");
    if (!verifyHmacHex(expected, signature)) {
      throw new Error("migros: invalid signature");
    }
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return [
        {
          providerId: this.id,
          type:
            (parsed?.eventType as string) ??
            (parsed?.status as string) ??
            "order.update",
          payload: parsed,
        },
      ];
    } catch {
      return [];
    }
  }

  // -- Order pull --------------------------------------------------------

  /** Pull new orders for the store. Read-only and idempotent. */
  async pullOrders(): Promise<Record<string, unknown>[]> {
    this.requireStore();
    const res = (await this.httpRequest(
      "GET",
      `/yemek/restaurants/${this.cfg.storeId}/orders?status=NEW`,
    )) as { orders?: unknown[] };
    const orders = Array.isArray(res) ? res : (res?.orders ?? []);
    return (orders as Record<string, unknown>[]) ?? [];
  }

  // -- Acknowledge / approve / reject -----------------------------------

  /** Accept an incoming order. Idempotent on the platform side. */
  async acknowledgeOrder(orderId: string): Promise<void> {
    await this.httpRequest("PUT", `/yemek/orders/${orderId}/status`, {
      status: "ACCEPTED",
    });
    this.logger.debug(`migros_yemek: acknowledged order ${orderId}`);
  }

  /** Reject an incoming order with an optional reason. */
  async rejectOrder(orderId: string, reason?: string): Promise<void> {
    await this.httpRequest("PUT", `/yemek/orders/${orderId}/status`, {
      status: "REJECTED",
      reason: reason ?? "Restaurant rejected the order",
    });
    this.logger.debug(`migros_yemek: rejected order ${orderId}`);
  }

  // -- Push order status -------------------------------------------------

  /** Push a downstream status to Migros. Re-sending a status is a no-op. */
  async syncOrderStatus(orderId: string, status: string): Promise<void> {
    await this.httpRequest("PUT", `/yemek/orders/${orderId}/status`, {
      status: this.mapStatus(status),
    });
    this.logger.debug(`migros_yemek: order ${orderId} → ${status}`);
  }

  // -- Menu availability -------------------------------------------------

  /** Open or close a single product. */
  async setProductAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    this.requireStore();
    await this.httpRequest(
      "PUT",
      `/yemek/restaurants/${this.cfg.storeId}/products/${externalItemId}/status`,
      { isAvailable: available },
    );
    this.logger.debug(
      `migros_yemek: product ${externalItemId} availability=${available}`,
    );
  }

  /** Open or close the store. */
  async setStoreOpen(open: boolean): Promise<void> {
    this.requireStore();
    await this.httpRequest(
      "PUT",
      `/yemek/restaurants/${this.cfg.storeId}/status`,
      { isOpen: open },
    );
    this.logger.debug(`migros_yemek: store open=${open}`);
  }

  // -- Internals ---------------------------------------------------------

  private mapStatus(status: string): string {
    return status.toUpperCase();
  }

  private requireStore(): void {
    if (!this.cfg.storeId) {
      throw new Error("migros: storeId not configured");
    }
  }

  private baseUrl(): string {
    return this.cfg.baseUrl?.replace(/\/+$/, "") ?? MIGROS_DEFAULT_BASE_URL;
  }

  private async httpRequest(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.cfg.apiKey) {
      throw new Error("migros: apiKey not configured");
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-Key": this.cfg.apiKey,
      "X-Store-Id": this.cfg.storeId ?? "",
    };
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`migros: ${method} ${path} -> ${res.status} ${text}`);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
}
