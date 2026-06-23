import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  IntegrationAdapter,
  IntegrationKind,
} from "../integration-adapter.interface";
import { verifyHmacHex } from "../sig-verify";

/**
 * Trendyol Yemek (Trendyol GO / TGO partner API) — REAL adapter.
 *
 * Live counterpart of the `trendyol_yemek` scaffold. Trendyol's partner API
 * authenticates with HTTP Basic over base64(apiKey:apiSecret) plus a
 * supplier-scoped path. Documented endpoints used here:
 *   - GET  /mealgw/suppliers/:supplierId/orders?packageStatuses=Created
 *          (pull new orders)
 *   - PUT  /mealgw/suppliers/:supplierId/orders/:orderId/status
 *          (accept / reject / status push: Picking, Invoiced, etc.)
 *   - PUT  /mealgw/suppliers/:supplierId/products/price-and-inventory
 *          (open / close a product)
 *   - PUT  /mealgw/suppliers/:supplierId/status (open / close store)
 * Webhook signature: HMAC-SHA256(rawBody, secret), hex, `trendyol-signature`.
 *
 * Registers under `trendyol_yemek_live`. Basic-auth needs no token exchange,
 * so there is no login round-trip; the header is recomputed from config.
 * Credentials come from init(config); nothing is hardcoded.
 */

const TRENDYOL_DEFAULT_BASE_URL = "https://api.tgoapis.com";
const HTTP_TIMEOUT_MS = 10_000;

interface TrendyolConfig {
  supplierId?: string;
  apiKey?: string;
  apiSecret?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

interface TrendyolIntegrationEvent {
  providerId: string;
  type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class TrendyolYemekLiveAdapter implements IntegrationAdapter {
  readonly id = "trendyol_yemek_live";
  readonly kind: IntegrationKind = "delivery";
  readonly configSchema = {
    type: "object",
    required: ["supplierId", "apiKey", "apiSecret"],
    properties: {
      supplierId: { type: "string", description: "Trendyol supplier id" },
      apiKey: { type: "string", description: "Trendyol API key" },
      apiSecret: { type: "string", description: "Trendyol API secret" },
      webhookSecret: {
        type: "string",
        description: "Webhook signing secret (falls back to apiSecret)",
      },
      baseUrl: { type: "string", description: "Override API base URL" },
    },
  };

  private readonly logger = new Logger(TrendyolYemekLiveAdapter.name);
  private cfg: TrendyolConfig = {};

  async init(config: TrendyolConfig): Promise<void> {
    this.cfg = config ?? {};
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    const configured = Boolean(
      this.cfg.supplierId && this.cfg.apiKey && this.cfg.apiSecret,
    );
    if (!configured) {
      return { ok: false, details: { configured } };
    }
    try {
      // Cheap authenticated read against the supplier's order feed.
      await this.httpRequest(
        "GET",
        `/mealgw/suppliers/${this.cfg.supplierId}/orders?packageStatuses=Created&size=1`,
      );
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
  ): Promise<TrendyolIntegrationEvent[]> {
    const body = typeof raw === "string" ? raw : raw.toString("utf8");
    const secret = this.cfg.webhookSecret ?? this.cfg.apiSecret;
    if (!secret) {
      throw new Error("trendyol: webhook secret not configured");
    }
    const expected = createHmac("sha256", secret).update(body).digest("hex");
    if (!verifyHmacHex(expected, signature)) {
      throw new Error("trendyol: invalid signature");
    }
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return [
        {
          providerId: this.id,
          type: (parsed?.type as string) ?? "order.update",
          payload: parsed,
        },
      ];
    } catch {
      return [];
    }
  }

  // -- Order pull --------------------------------------------------------

  /** Pull newly created orders for the supplier. Read-only, idempotent. */
  async pullOrders(): Promise<Record<string, unknown>[]> {
    this.requireSupplier();
    const res = (await this.httpRequest(
      "GET",
      `/mealgw/suppliers/${this.cfg.supplierId}/orders?packageStatuses=Created`,
    )) as { content?: unknown[]; orders?: unknown[] };
    const orders = res?.content ?? res?.orders ?? [];
    return (orders as Record<string, unknown>[]) ?? [];
  }

  // -- Acknowledge / approve / reject -----------------------------------

  /** Accept an order (move to Picking). Idempotent on the platform side. */
  async acknowledgeOrder(orderId: string): Promise<void> {
    await this.pushStatus(orderId, { status: "Picking" });
    this.logger.debug(`trendyol_yemek_live: acknowledged order ${orderId}`);
  }

  /** Reject (un-supply / cancel) an order with an optional reason. */
  async rejectOrder(orderId: string, reason?: string): Promise<void> {
    await this.pushStatus(orderId, {
      status: "UnSupplied",
      reason: reason ?? "Restaurant rejected the order",
    });
    this.logger.debug(`trendyol_yemek_live: rejected order ${orderId}`);
  }

  // -- Push order status -------------------------------------------------

  /** Push a downstream status to Trendyol. Re-sending a status is a no-op. */
  async syncOrderStatus(orderId: string, status: string): Promise<void> {
    await this.pushStatus(orderId, { status: this.mapStatus(status) });
    this.logger.debug(`trendyol_yemek_live: order ${orderId} → ${status}`);
  }

  // -- Menu availability -------------------------------------------------

  /** Open or close a single product via the price-and-inventory endpoint. */
  async setProductAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    this.requireSupplier();
    await this.httpRequest(
      "PUT",
      `/mealgw/suppliers/${this.cfg.supplierId}/products/price-and-inventory`,
      {
        items: [
          {
            productId: externalItemId,
            // Trendyol toggles availability via stock quantity: 0 = sold out.
            stockQuantity: available ? 1 : 0,
            isActive: available,
          },
        ],
      },
    );
    this.logger.debug(
      `trendyol_yemek_live: product ${externalItemId} availability=${available}`,
    );
  }

  /** Open or close the store. */
  async setStoreOpen(open: boolean): Promise<void> {
    this.requireSupplier();
    await this.httpRequest(
      "PUT",
      `/mealgw/suppliers/${this.cfg.supplierId}/status`,
      { status: open ? "OPEN" : "CLOSED" },
    );
    this.logger.debug(`trendyol_yemek_live: store open=${open}`);
  }

  // -- Internals ---------------------------------------------------------

  private mapStatus(status: string): string {
    switch (status.toUpperCase()) {
      case "ACCEPTED":
      case "PREPARING":
      case "PICKING":
        return "Picking";
      case "READY":
      case "INVOICED":
        return "Invoiced";
      case "SHIPPED":
      case "PICKED_UP":
        return "Shipped";
      case "DELIVERED":
        return "Delivered";
      case "REJECTED":
      case "CANCELLED":
      case "UNSUPPLIED":
        return "UnSupplied";
      default:
        return status;
    }
  }

  private pushStatus(
    orderId: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    this.requireSupplier();
    return this.httpRequest(
      "PUT",
      `/mealgw/suppliers/${this.cfg.supplierId}/orders/${orderId}/status`,
      body,
    );
  }

  private requireSupplier(): void {
    if (!this.cfg.supplierId) {
      throw new Error("trendyol: supplierId not configured");
    }
  }

  private authHeader(): string {
    const raw = `${this.cfg.apiKey ?? ""}:${this.cfg.apiSecret ?? ""}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
  }

  private baseUrl(): string {
    return this.cfg.baseUrl?.replace(/\/+$/, "") ?? TRENDYOL_DEFAULT_BASE_URL;
  }

  private async httpRequest(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.cfg.apiKey || !this.cfg.apiSecret) {
      throw new Error("trendyol: credentials not configured");
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: this.authHeader(),
      // Trendyol requires a descriptive User-Agent of the form
      // "supplierId - SelfIntegration".
      "User-Agent": `${this.cfg.supplierId ?? ""} - SelfIntegration`,
    };
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`trendyol: ${method} ${path} -> ${res.status} ${text}`);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
}
