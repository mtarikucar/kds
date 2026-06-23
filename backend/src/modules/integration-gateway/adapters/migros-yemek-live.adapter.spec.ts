import { createHmac } from "node:crypto";
import { MigrosYemekLiveAdapter } from "./migros-yemek-live.adapter";

/**
 * MigrosYemekLiveAdapter — REAL HTTP partner-API adapter (the first Migros
 * adapter in the integration gateway).
 *
 * Covers the fail-closed webhook gate and the live HTTP calls: per-store
 * API-key header auth (no token exchange), order pull, accept / reject,
 * status push, product availability, and store open/close. Credentials read
 * from config, never hardcoded.
 */

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

type FetchCall = { url: string; init: RequestInit };

function installFetch(handler: (url: string, init: RequestInit) => unknown): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const real = global.fetch;
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    const body = handler(String(url), init);
    return {
      ok: true,
      status: 200,
      text: jest
        .fn()
        .mockResolvedValue(body == null ? "" : JSON.stringify(body)),
    } as any;
  }) as any;
  return { calls, restore: () => (global.fetch = real) };
}

describe("MigrosYemekLiveAdapter", () => {
  let adapter: MigrosYemekLiveAdapter;
  const secret = "migros-webhook-secret";
  const creds = { apiKey: "AK1", storeId: "ST1", webhookSecret: secret };

  beforeEach(async () => {
    adapter = new MigrosYemekLiveAdapter();
    await adapter.init(creds);
  });

  it("exposes the migros_yemek id and required credentials", () => {
    expect(adapter.id).toBe("migros_yemek");
    expect(adapter.kind).toBe("delivery");
    expect(adapter.configSchema).toMatchObject({
      required: ["apiKey", "storeId"],
    });
  });

  // -- webhook gate -------------------------------------------------------

  it("fails CLOSED when no webhookSecret is configured", async () => {
    const bare = new MigrosYemekLiveAdapter();
    await bare.init({ apiKey: "k", storeId: "s" });
    await expect(bare.parseWebhook("sig", "{}")).rejects.toThrow(
      "migros: webhook secret not configured",
    );
  });

  it("rejects a signature that does not match the body", async () => {
    const body = JSON.stringify({ eventType: "order.created" });
    await expect(
      adapter.parseWebhook(sign(secret, "tampered"), body),
    ).rejects.toThrow("migros: invalid signature");
  });

  it("uses eventType, then status, then order.update", async () => {
    const b1 = JSON.stringify({ eventType: "E", status: "S" });
    expect((await adapter.parseWebhook(sign(secret, b1), b1))[0].type).toBe(
      "E",
    );
    const b2 = JSON.stringify({ status: "PREPARING" });
    expect((await adapter.parseWebhook(sign(secret, b2), b2))[0].type).toBe(
      "PREPARING",
    );
    const b3 = JSON.stringify({ ref: "x" });
    expect((await adapter.parseWebhook(sign(secret, b3), b3))[0].type).toBe(
      "order.update",
    );
  });

  it("swallows a valid-signed but non-JSON body", async () => {
    const body = "not json{";
    expect(await adapter.parseWebhook(sign(secret, body), body)).toEqual([]);
  });

  // -- HTTP: api-key header + calls --------------------------------------

  it("sends the per-store API key header on every call", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.acknowledgeOrder("o1");
      const call = f.calls[0];
      expect((call.init.headers as any)["X-API-Key"]).toBe("AK1");
      expect((call.init.headers as any)["X-Store-Id"]).toBe("ST1");
      expect(call.url).toBe(
        "https://partner-api.migros.com.tr/yemek/orders/o1/status",
      );
      expect(call.init.method).toBe("PUT");
      expect(JSON.parse(call.init.body as string)).toEqual({
        status: "ACCEPTED",
      });
    } finally {
      f.restore();
    }
  });

  it("pulls new orders for the store", async () => {
    const f = installFetch(() => ({ orders: [{ id: "a" }] }));
    try {
      const out = await adapter.pullOrders();
      expect(out).toEqual([{ id: "a" }]);
      expect(f.calls[0].url).toBe(
        "https://partner-api.migros.com.tr/yemek/restaurants/ST1/orders?status=NEW",
      );
    } finally {
      f.restore();
    }
  });

  it("rejects an order with a reason", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.rejectOrder("o2", "busy");
      expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
        status: "REJECTED",
        reason: "busy",
      });
    } finally {
      f.restore();
    }
  });

  it("pushes a status (upper-cased) to the order status endpoint", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.syncOrderStatus("o3", "preparing");
      const call = f.calls[0];
      expect(call.url).toBe(
        "https://partner-api.migros.com.tr/yemek/orders/o3/status",
      );
      expect(JSON.parse(call.init.body as string)).toEqual({
        status: "PREPARING",
      });
    } finally {
      f.restore();
    }
  });

  it("opens/closes a product", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.setProductAvailability("p1", false);
      const call = f.calls[0];
      expect(call.url).toBe(
        "https://partner-api.migros.com.tr/yemek/restaurants/ST1/products/p1/status",
      );
      expect(JSON.parse(call.init.body as string)).toEqual({
        isAvailable: false,
      });
    } finally {
      f.restore();
    }
  });

  it("opens/closes the store", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.setStoreOpen(true);
      const call = f.calls[0];
      expect(call.url).toBe(
        "https://partner-api.migros.com.tr/yemek/restaurants/ST1/status",
      );
      expect(JSON.parse(call.init.body as string)).toEqual({ isOpen: true });
    } finally {
      f.restore();
    }
  });

  it("throws on a non-OK HTTP response", async () => {
    const real = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: jest.fn().mockResolvedValue("not found"),
    })) as any;
    try {
      await expect(adapter.acknowledgeOrder("x")).rejects.toThrow(/404/);
    } finally {
      global.fetch = real;
    }
  });

  it("healthCheck is false when unconfigured", async () => {
    const bare = new MigrosYemekLiveAdapter();
    await bare.init({});
    expect(await bare.healthCheck()).toEqual({
      ok: false,
      details: { configured: false },
    });
  });

  it("healthCheck is true when the store probe succeeds", async () => {
    const f = installFetch(() => ({ id: "ST1" }));
    try {
      expect(await adapter.healthCheck()).toEqual({
        ok: true,
        details: { configured: true },
      });
    } finally {
      f.restore();
    }
  });
});
