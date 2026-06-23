import { createHmac } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  IntegrationAdapter,
  IntegrationKind,
} from "../integration-adapter.interface";
import { verifyHmacHex } from "../sig-verify";

/**
 * Yemeksepeti (Delivery Hero, "vendor middleware" API) — REAL adapter.
 *
 * Live counterpart of the `yemeksepeti` scaffold. Calls the documented
 * Yemeksepeti / Delivery Hero vendor middleware REST API:
 *   - POST /v2/login (client_credentials → bearer access_token)
 *   - POST /v2/order/status/:orderToken (accept / reject / status push)
 *   - POST /v2/orders/:orderToken/preparation-completed (mark ready)
 *   - PUT  /v2/chains/:chainCode/vendors/:vendorId/catalog/items/availability
 *         (open / close a product)
 *   - PUT  /v2/vendors/:vendorId/status (open / close the restaurant)
 * Webhook signature: HMAC-SHA256(rawBody, secret), hex, `x-vendor-hmac`.
 *
 * Registers under `yemeksepeti_live` so it coexists with the scaffold during
 * onboarding. Credentials come from init(config); nothing is hardcoded.
 * The access token is cached per instance and reused until ~5 min before
 * expiry. Status pushes are idempotent (re-sending a status is a no-op).
 */

const YS_DEFAULT_BASE_URL = "https://middleware-api.yemeksepeti.com";
const HTTP_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_SKEW_SEC = 300;

interface YemeksepetiConfig {
  clientId?: string;
  clientSecret?: string;
  chainCode?: string;
  vendorId?: string;
  secret?: string;
  baseUrl?: string;
}

interface YemeksepetiIntegrationEvent {
  providerId: string;
  type: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class YemeksepetiLiveAdapter implements IntegrationAdapter {
  readonly id = "yemeksepeti_live";
  readonly kind: IntegrationKind = "delivery";
  readonly configSchema = {
    type: "object",
    required: ["clientId", "clientSecret"],
    properties: {
      clientId: { type: "string", description: "OAuth client id" },
      clientSecret: { type: "string", description: "OAuth client secret" },
      chainCode: { type: "string", description: "Yemeksepeti chain code" },
      vendorId: { type: "string", description: "POS vendor id" },
      secret: { type: "string", description: "Webhook signing secret" },
      baseUrl: { type: "string", description: "Override API base URL" },
    },
  };

  private readonly logger = new Logger(YemeksepetiLiveAdapter.name);
  private cfg: YemeksepetiConfig = {};
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  async init(config: YemeksepetiConfig): Promise<void> {
    this.cfg = config ?? {};
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  async healthCheck(): Promise<{
    ok: boolean;
    details?: Record<string, unknown>;
  }> {
    const configured = Boolean(this.cfg.clientId && this.cfg.clientSecret);
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
  ): Promise<YemeksepetiIntegrationEvent[]> {
    const body = typeof raw === "string" ? raw : raw.toString("utf8");
    if (!this.cfg.secret) {
      throw new Error("yemeksepeti: webhook secret not configured");
    }
    const expected = createHmac("sha256", this.cfg.secret)
      .update(body)
      .digest("hex");
    if (!verifyHmacHex(expected, signature)) {
      throw new Error("yemeksepeti: invalid signature");
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

  /**
   * Yemeksepeti pushes orders via webhook rather than offering a poll feed,
   * so pull is a no-op feed: live order intake happens through parseWebhook.
   * Kept for interface symmetry; returns [].
   */
  async pullOrders(): Promise<Record<string, unknown>[]> {
    this.logger.debug(
      "yemeksepeti_live: order intake is webhook-driven; pullOrders is a no-op",
    );
    return [];
  }

  // -- Acknowledge / approve / reject -----------------------------------

  /** Accept an incoming order. Idempotent on the platform side. */
  async acknowledgeOrder(orderToken: string): Promise<void> {
    const token = await this.getToken();
    await this.httpRequest("POST", `/v2/order/status/${orderToken}`, token, {
      status: "accepted",
    });
    this.logger.debug(`yemeksepeti_live: accepted order ${orderToken}`);
  }

  /** Reject an incoming order with an optional reason. */
  async rejectOrder(orderToken: string, reason?: string): Promise<void> {
    const token = await this.getToken();
    await this.httpRequest("POST", `/v2/order/status/${orderToken}`, token, {
      status: "rejected",
      reason: reason ?? "Restaurant rejected the order",
    });
    this.logger.debug(`yemeksepeti_live: rejected order ${orderToken}`);
  }

  // -- Push order status -------------------------------------------------

  /**
   * Push a downstream status to Yemeksepeti. "ready" uses the dedicated
   * preparation-completed endpoint; everything else maps onto the generic
   * status endpoint. Re-sending the same status is a no-op.
   */
  async syncOrderStatus(orderToken: string, status: string): Promise<void> {
    const token = await this.getToken();
    const normalized = status.toLowerCase();
    if (normalized === "ready") {
      await this.httpRequest(
        "POST",
        `/v2/orders/${orderToken}/preparation-completed`,
        token,
      );
    } else {
      await this.httpRequest("POST", `/v2/order/status/${orderToken}`, token, {
        status: normalized,
      });
    }
    this.logger.debug(`yemeksepeti_live: order ${orderToken} → ${status}`);
  }

  // -- Menu availability -------------------------------------------------

  /** Open or close a single catalog item. */
  async setProductAvailability(
    externalItemId: string,
    available: boolean,
  ): Promise<void> {
    const token = await this.getToken();
    const { chainCode, vendorId } = this.cfg;
    if (!chainCode || !vendorId) {
      throw new Error("yemeksepeti: chainCode and vendorId required");
    }
    await this.httpRequest(
      "PUT",
      `/v2/chains/${chainCode}/vendors/${vendorId}/catalog/items/availability`,
      token,
      { items: [{ id: externalItemId, available }] },
    );
    this.logger.debug(
      `yemeksepeti_live: item ${externalItemId} availability=${available}`,
    );
  }

  /** Open or close the vendor (restaurant). */
  async setRestaurantOpen(open: boolean): Promise<void> {
    const token = await this.getToken();
    if (!this.cfg.vendorId) {
      throw new Error("yemeksepeti: vendorId required");
    }
    await this.httpRequest(
      "PUT",
      `/v2/vendors/${this.cfg.vendorId}/status`,
      token,
      { isOpen: open },
    );
    this.logger.debug(`yemeksepeti_live: restaurant open=${open}`);
  }

  // -- Internals ---------------------------------------------------------

  private async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }
    if (!this.cfg.clientId || !this.cfg.clientSecret) {
      throw new Error("yemeksepeti: credentials not configured");
    }
    const res = (await this.httpRequest("POST", "/v2/login", null, {
      grant_type: "client_credentials",
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    })) as { access_token?: string; expires_in?: number };
    const token = res?.access_token;
    if (!token) {
      throw new Error("yemeksepeti: login returned no access_token");
    }
    const expiresIn = res.expires_in ?? 3600;
    this.cachedToken = token;
    this.tokenExpiresAt =
      Date.now() + (expiresIn - TOKEN_REFRESH_SKEW_SEC) * 1000;
    return token;
  }

  private baseUrl(): string {
    return this.cfg.baseUrl?.replace(/\/+$/, "") ?? YS_DEFAULT_BASE_URL;
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
      throw new Error(
        `yemeksepeti: ${method} ${path} -> ${res.status} ${text}`,
      );
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
}
