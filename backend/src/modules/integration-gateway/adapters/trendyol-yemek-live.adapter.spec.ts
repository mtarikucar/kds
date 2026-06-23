import { createHmac } from "node:crypto";
import { TrendyolYemekLiveAdapter } from "./trendyol-yemek-live.adapter";

/**
 * TrendyolYemekLiveAdapter — REAL HTTP partner-API adapter.
 *
 * Covers the fail-closed webhook gate (with the webhookSecret→apiSecret
 * fallback chain, mirroring the scaffold matrix) and the live HTTP calls:
 *   Basic-auth header derived from apiKey:apiSecret (no token round-trip),
 *   order pull, accept (Picking) / reject (UnSupplied), status mapping,
 *   product availability via price-and-inventory, and store open/close.
 * Credentials read from config, never hardcoded.
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

describe("TrendyolYemekLiveAdapter", () => {
  let adapter: TrendyolYemekLiveAdapter;
  const apiSecret = "tr-api-secret";
  const creds = { supplierId: "S1", apiKey: "K1", apiSecret };

  beforeEach(async () => {
    adapter = new TrendyolYemekLiveAdapter();
    await adapter.init(creds);
  });

  it("exposes the live id and required credentials", () => {
    expect(adapter.id).toBe("trendyol_yemek_live");
    expect(adapter.kind).toBe("delivery");
    expect(adapter.configSchema).toMatchObject({
      required: ["supplierId", "apiKey", "apiSecret"],
    });
  });

  // -- webhook gate -------------------------------------------------------

  it("falls back to apiSecret when no webhookSecret is set", async () => {
    const body = JSON.stringify({ type: "order.canceled" });
    const out = await adapter.parseWebhook(sign(apiSecret, body), body);
    expect(out[0]).toMatchObject({
      providerId: "trendyol_yemek_live",
      type: "order.canceled",
    });
  });

  it("prefers webhookSecret over apiSecret when both are present", async () => {
    const wh = "dedicated-webhook-secret";
    const a = new TrendyolYemekLiveAdapter();
    await a.init({
      supplierId: "S1",
      apiKey: "k",
      apiSecret,
      webhookSecret: wh,
    });
    const body = JSON.stringify({ type: "order.update" });
    await expect(a.parseWebhook(sign(apiSecret, body), body)).rejects.toThrow(
      "trendyol: invalid signature",
    );
    expect(await a.parseWebhook(sign(wh, body), body)).toHaveLength(1);
  });

  it("throws when neither webhookSecret nor apiSecret is configured", async () => {
    const bare = new TrendyolYemekLiveAdapter();
    await bare.init({ supplierId: "S1", apiKey: "k" });
    await expect(bare.parseWebhook("sig", "{}")).rejects.toThrow(
      "trendyol: webhook secret not configured",
    );
  });

  it("defaults type to order.update and swallows non-JSON", async () => {
    const body = JSON.stringify({ orderId: 1 });
    expect(
      (await adapter.parseWebhook(sign(apiSecret, body), body))[0].type,
    ).toBe("order.update");
    const garbage = "<<garbage";
    expect(
      await adapter.parseWebhook(sign(apiSecret, garbage), garbage),
    ).toEqual([]);
  });

  // -- HTTP: basic auth + calls ------------------------------------------

  it("uses HTTP Basic auth derived from apiKey:apiSecret", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.acknowledgeOrder("ord-1");
      const call = f.calls[0];
      const expected =
        "Basic " + Buffer.from(`K1:${apiSecret}`).toString("base64");
      expect((call.init.headers as any).Authorization).toBe(expected);
      expect((call.init.headers as any)["User-Agent"]).toBe(
        "S1 - SelfIntegration",
      );
      expect(call.url).toBe(
        "https://api.tgoapis.com/mealgw/suppliers/S1/orders/ord-1/status",
      );
      expect(JSON.parse(call.init.body as string)).toEqual({
        status: "Picking",
      });
    } finally {
      f.restore();
    }
  });

  it("pulls Created orders from the content array", async () => {
    const f = installFetch(() => ({ content: [{ id: 1 }, { id: 2 }] }));
    try {
      const out = await adapter.pullOrders();
      expect(out).toEqual([{ id: 1 }, { id: 2 }]);
      expect(f.calls[0].url).toContain("packageStatuses=Created");
    } finally {
      f.restore();
    }
  });

  it("rejects an order as UnSupplied with a reason", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.rejectOrder("ord-2", "no stock");
      expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
        status: "UnSupplied",
        reason: "no stock",
      });
    } finally {
      f.restore();
    }
  });

  it("maps a downstream status to the Trendyol vocabulary", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.syncOrderStatus("ord-3", "READY");
      expect(JSON.parse(f.calls[0].init.body as string)).toEqual({
        status: "Invoiced",
      });
    } finally {
      f.restore();
    }
  });

  it("toggles product availability via price-and-inventory (0 = sold out)", async () => {
    const f = installFetch(() => ({}));
    try {
      await adapter.setProductAvailability("p9", false);
      const call = f.calls[0];
      expect(call.url).toBe(
        "https://api.tgoapis.com/mealgw/suppliers/S1/products/price-and-inventory",
      );
      expect(JSON.parse(call.init.body as string)).toEqual({
        items: [{ productId: "p9", stockQuantity: 0, isActive: false }],
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
        "https://api.tgoapis.com/mealgw/suppliers/S1/status",
      );
      expect(JSON.parse(call.init.body as string)).toEqual({ status: "OPEN" });
    } finally {
      f.restore();
    }
  });

  it("throws on a non-OK HTTP response", async () => {
    const real = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue("boom"),
    })) as any;
    try {
      await expect(adapter.acknowledgeOrder("o")).rejects.toThrow(/500/);
    } finally {
      global.fetch = real;
    }
  });

  it("healthCheck is false when unconfigured", async () => {
    const bare = new TrendyolYemekLiveAdapter();
    await bare.init({ apiKey: "k" });
    expect(await bare.healthCheck()).toEqual({
      ok: false,
      details: { configured: false },
    });
  });
});
