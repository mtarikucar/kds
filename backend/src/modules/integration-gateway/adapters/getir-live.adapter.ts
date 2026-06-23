import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  IntegrationAdapter,
  IntegrationKind,
} from "../integration-adapter.interface";
import { verifyHmacHex } from "../sig-verify";

/**
 * Getir Yemek (Getir Food) — REAL merchant-API adapter.
 *
 * This is the live counterpart of the `getir` scaffold (`getir.adapter.ts`,
 * which only normalises webhooks). It performs the actual HTTP calls against
 * the documented Getir Food external merchant API:
 *   - POST /auth/login            → bearer token from app+restaurant secrets
 *   - POST /food-orders/periodic/unapproved (pull new/unapproved orders)
 *   - POST /food-orders/:id/verify | /cancel (approve / reject)
 *   - POST /food-orders/:id/prepare | /handover | /deliver (push status)
 *   - PUT  /food-products/:id/status (open / close a product)
 * Webhook signature: HMAC-SHA256(rawBody, webhookSecret), hex, `x-getir-hmac`.
 *
 * It registers under a distinct id (`getir_live`) so it can coexist with the
 * scaffold while the live integration is being onboarded; the gateway module
 * wires the chosen adapter into its providers[] array. Credentials are NEVER
 * hardcoded — they arrive via init(config) from the tenant's encrypted
 * integration connection.
 *
 * The token obtained by authenticate() is cached in-memory per adapter
 * instance and reused until ~5 min before expiry, so high-frequency polling
 * does not re-login on every call. ack/status/availability calls are
 * inherently idempotent on the platform side (re-sending the same target
 * status is a no-op), so retries are safe.
 */

const GETIR_DEFAULT_BASE_URL = "https://food-external-api.getir.com";
const HTTP_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

interface GetirConfig {
  appSecretKey?: string;
  restaurantSecretKey?: string;
  restaurantId?: string;
  webhookSecret?: string;
  baseUrl?: string;
}

interface GetirIntegrationEvent {
  providerId: string;
  type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class GetirLiveAdapter implements IntegrationAdapter {
  readonly id = "getir_live";
  readonly kind: IntegrationKind = "delivery";
  readonly configSchema = {
    type: "object",
    required: ["appSecretKey", "restaurantSecretKey"],
    properties: {
      appSecretKey: { type: "string", description: "Getir app secret key" },
      restaurantSecretKey: {
        type: "string",
        description: "Getir restaurant secret key",
      },
      restaurantId: { type: "string", description: "Getir restaurant id" },
      webhookSecret: { type: "string", description: "Webhook signing secret" },
      baseUrl: { type: "string", description: "Override API base URL" },
    },
  };

  private readonly logger = new Logger(GetirLiveAdapter.name);
  private cfg: GetirConfig = {};
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  async init(config: GetirConfig): Promise<void> {
    this.cfg = config ?? {};
    // A re-init may carry rotated secrets; drop any cached token.
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    const configured = Boolean(
      this.cfg.appSecretKey && this.cfg.restaurantSecretKey,
    );
    if (!configured) {
      return { ok: false, details: { configured } };
    }
    try {
      await this.getToken();
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
  ): Promise<GetirIntegrationEvent[]> {
    const body = typeof raw === "string" ? raw : raw.toString("utf8");
    if (!this.cfg.webhookSecret) {
      throw new Error("getir: webhook secret not configured");
    }
    const expected = createHmac("sha256", this.cfg.webhookSecret)
      .update(body)
      .digest("hex");
    if (!verifyHmacHex(expected, signature)) {
      throw new Error("getir: invalid signature");
    }
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      return [
        {
          providerId: this.id,
          type: (parsed?.eventName as string) ?? "order.update",
          payload: parsed,
        },
      ];
    } catch {
      return [];
    }
  }

  // -- Order pull --------------------------------------------------------

  /**
   * Pull unapproved (incoming) orders. Returns the platform's raw order
   * objects; the delivery-platforms module owns mapping into the Order
   * entity. Read-only and idempotent.
   */
  async pullOrders(): Promise<Record<string, unknown>[]> {
    const token = await this.getToken();
    const res = await this.httpRequest(
      "POST",
      "/food-orders/periodic/unapproved",
      token,
    );
    const data = (res as { orders?: unknown[] }) ?? {};
    const orders = Array.isArray(data) ? data : (data.orders ?? []);
    return (orders as Record<string, unknown>[]) ?? [];
  }

  // -- Acknowledge / approve / reject -----------------------------------

  /** Approve (verify) an incoming order. Idempotent on the platform side. */
  async acknowledgeOrder(orderId: string): Promise<void> {
    const token = await this.getToken();
    await this.httpRequest("POST", `/food-orders/${orderId}/verify`, token);
    this.logger.debug(`getir_live: acknowledged order ${orderId}`);
  }

  /** Reject an incoming order with an optional reason. */
  async rejectOrder(orderId: string, reason?: string): Promise<void> {
    const token = await this.getToken();
    await this.httpRequest("POST", `/food-orders/${orderId}/cancel`, token, {
      rejectReason: reason ?? "Restaurant rejected the order",
    });
    this.logger.debug(`getir_live: rejected order ${orderId}`);
  }

  // -- Push order status -------------------------------------------------

  /**
   * Push a downstream KDS status to Getir. The internal status string is
   * mapped to the Getir endpoint. Re-sending the same status is a no-op on
   * the platform, so this is safe to retry.
   */
  async syncOrderStatus(orderId: string, status: string): Promise<void> {
    const token = await this.getToken();
    const endpoint = this.statusEndpoint(status);
    if (!endpoint) {
      // Getir delivers via its own courier; "picked up" / terminal states
      // have no merchant-side call — log and treat as a successful no-op.
      this.logger.debug(
        `getir_live: status '${status}' for order ${orderId} has no upstream call (no-op)`,
      );
      return;
    }
    await this.httpRequest(
      "POST",
      `/food-orders/${orderId}/${endpoint}`,
      token,
    );
    this.logger.debug(`getir_live: order ${orderId} → ${status} (${endpoint})`);
  }

  // -- Menu availability -------------------------------------------------

  /** Open or close a single product (set availability). */
  async setProductAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    const token = await this.getToken();
    await this.httpRequest(
      "PUT",
      `/food-products/${externalItemId}/status`,
      token,
      { isActive: available },
    );
    this.logger.debug(
      `getir_live: product ${externalItemId} availability=${available}`,
    );
  }

  // -- Internals ---------------------------------------------------------

  private statusEndpoint(status: string): string | null {
    switch (status.toUpperCase()) {
      case "ACCEPTED":
      case "VERIFIED":
        return "verify";
      case "PREPARING":
        return "prepare";
      case "READY":
      case "HANDOVER":
        return "handover";
      case "DELIVERED":
        return "deliver";
      case "CANCELLED":
      case "REJECTED":
        return "cancel";
      default:
        return null;
    }
  }

  /** Login with app+restaurant secret keys, caching the token until expiry. */
  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    if (!this.cfg.appSecretKey || !this.cfg.restaurantSecretKey) {
      throw new Error("getir: credentials not configured");
    }
    const res = (await this.httpRequest("POST", "/auth/login", null, {
      appSecretKey: this.cfg.appSecretKey,
      restaurantSecretKey: this.cfg.restaurantSecretKey,
    })) as { token?: string };
    const token = res?.token;
    if (!token) {
      throw new Error("getir: login returned no token");
    }
    this.cachedToken = token;
    // Getir tokens live ~1h; refresh slightly early.
    this.tokenExpiresAt = Date.now() + 55 * 60 * 1000 - TOKEN_REFRESH_SKEW_MS;
    return token;
  }

  private baseUrl(): string {
    return this.cfg.baseUrl?.replace(/\/+$/, "") ?? GETIR_DEFAULT_BASE_URL;
  }

  private async httpRequest(
    method: "GET" | "POST" | "PUT",
    path: string,
    token: string | null,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${this.baseUrl()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`getir: ${method} ${path} -> ${res.status} ${text}`);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
}
