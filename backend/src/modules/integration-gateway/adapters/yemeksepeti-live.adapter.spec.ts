import { createHmac } from "node:crypto";
import { YemeksepetiLiveAdapter } from "./yemeksepeti-live.adapter";

/**
 * YemeksepetiLiveAdapter — REAL HTTP vendor-middleware adapter.
 *
 * Covers the fail-closed webhook HMAC gate (mirrors the scaffold matrix) and
 * the live HTTP calls: OAuth client_credentials login + token cache, accept /
 * reject, status push (incl. the dedicated preparation-completed endpoint for
 * "ready"), and item / vendor open-close availability. Credentials are read
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

describe("YemeksepetiLiveAdapter", () => {
  let adapter: YemeksepetiLiveAdapter;
  const secret = "ys-secret";
  const creds = {
    clientId: "cid",
    clientSecret: "csecret",
    chainCode: "CHAIN1",
    vendorId: "V1",
    secret,
  };

  beforeEach(async () => {
    adapter = new YemeksepetiLiveAdapter();
    await adapter.init(creds);
  });

  it("exposes the live id and required credentials in the schema", () => {
    expect(adapter.id).toBe("yemeksepeti_live");
    expect(adapter.kind).toBe("delivery");
    expect(adapter.configSchema).toMatchObject({
      required: ["clientId", "clientSecret"],
    });
  });

  // -- webhook gate -------------------------------------------------------

  it("fails CLOSED when no secret is configured", async () => {
    const bare = new YemeksepetiLiveAdapter();
    await bare.init({ clientId: "c", clientSecret: "s" });
    await expect(bare.parseWebhook("", "{}")).rejects.toThrow(
      "yemeksepeti: webhook secret not configured",
    );
  });

  it("rejects a tampered body under a valid-hex signature", async () => {
    const body = JSON.stringify({ eventType: "order.delivered" });
    await expect(
      adapter.parseWebhook(sign(secret, "other"), body),
    ).rejects.toThrow("yemeksepeti: invalid signature");
  });

  it("uses eventType first, then status, then order.update", async () => {
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

  it("accepts a sha256=-prefixed signature", async () => {
    const body = JSON.stringify({ eventType: "order.update" });
    const out = await adapter.parseWebhook(
      "sha256=" + sign(secret, body),
      body,
    );
    expect(out).toHaveLength(1);
  });

  // -- HTTP: OAuth + token cache -----------------------------------------

  it("logs in with client_credentials and bearers calls", async () => {
    const f = installFetch((url) => {
      if (url.endsWith("/v2/login"))
        return { access_token: "at-1", expires_in: 3600 };
      return {};
    });
    try {
      await adapter.acknowledgeOrder("ot1");
      const login = f.calls[0];
      expect(login.url).toBe("https://middleware-api.yemeksepeti.com/v2/login");
      expect(JSON.parse(login.init.body as string)).toEqual({
        grant_type: "client_credentials",
        client_id: "cid",
        client_secret: "csecret",
      });
      const accept = f.calls[1];
      expect(accept.url).toBe(
        "https://middleware-api.yemeksepeti.com/v2/order/status/ot1",
      );
      expect((accept.init.headers as any).Authorization).toBe("Bearer at-1");
      expect(JSON.parse(accept.init.body as string)).toEqual({
        status: "accepted",
      });
    } finally {
      f.restore();
    }
  });

  it("caches the token and only logs in once", async () => {
    const f = installFetch((url) =>
      url.endsWith("/v2/login") ? { access_token: "at", expires_in: 3600 } : {},
    );
    try {
      await adapter.acknowledgeOrder("o1");
      await adapter.acknowledgeOrder("o2");
      expect(f.calls.filter((c) => c.url.endsWith("/v2/login"))).toHaveLength(
        1,
      );
    } finally {
      f.restore();
    }
  });

  // -- HTTP: status / availability ---------------------------------------

  it("routes 'ready' to the preparation-completed endpoint", async () => {
    const f = installFetch((url) =>
      url.endsWith("/v2/login") ? { access_token: "at", expires_in: 60 } : {},
    );
    try {
      await adapter.syncOrderStatus("ot9", "ready");
      expect(
        f.calls.some((c) =>
          c.url.endsWith("/v2/orders/ot9/preparation-completed"),
        ),
      ).toBe(true);
    } finally {
      f.restore();
    }
  });

  it("rejects an order with a reason", async () => {
    const f = installFetch((url) =>
      url.endsWith("/v2/login") ? { access_token: "at", expires_in: 60 } : {},
    );
    try {
      await adapter.rejectOrder("ot1", "closed");
      const call = f.calls.find((c) => c.url.endsWith("/v2/order/status/ot1"));
      expect(JSON.parse(call!.init.body as string)).toEqual({
        status: "rejected",
        reason: "closed",
      });
    } finally {
      f.restore();
    }
  });

  it("opens/closes an item via the catalog availability endpoint", async () => {
    const f = installFetch((url) =>
      url.endsWith("/v2/login") ? { access_token: "at", expires_in: 60 } : {},
    );
    try {
      await adapter.setProductAvailability("item-7", true);
      const call = f.calls.find((c) =>
        c.url.includes("/catalog/items/availability"),
      );
      expect(call!.url).toBe(
        "https://middleware-api.yemeksepeti.com/v2/chains/CHAIN1/vendors/V1/catalog/items/availability",
      );
      expect(JSON.parse(call!.init.body as string)).toEqual({
        items: [{ id: "item-7", available: true }],
      });
    } finally {
      f.restore();
    }
  });

  it("opens/closes the vendor", async () => {
    const f = installFetch((url) =>
      url.endsWith("/v2/login") ? { access_token: "at", expires_in: 60 } : {},
    );
    try {
      await adapter.setRestaurantOpen(false);
      const call = f.calls.find((c) => c.url.endsWith("/v2/vendors/V1/status"));
      expect(JSON.parse(call!.init.body as string)).toEqual({ isOpen: false });
    } finally {
      f.restore();
    }
  });

  it("throws if availability is called without chainCode/vendorId", async () => {
    const partial = new YemeksepetiLiveAdapter();
    await partial.init({ clientId: "c", clientSecret: "s", secret });
    const f = installFetch(() => ({ access_token: "at", expires_in: 60 }));
    try {
      await expect(partial.setProductAvailability("x", true)).rejects.toThrow(
        "chainCode and vendorId required",
      );
    } finally {
      f.restore();
    }
  });

  it("pullOrders is a no-op (webhook-driven) returning []", async () => {
    expect(await adapter.pullOrders()).toEqual([]);
  });

  it("healthCheck is false when unconfigured", async () => {
    const bare = new YemeksepetiLiveAdapter();
    await bare.init({ secret });
    expect(await bare.healthCheck()).toEqual({
      ok: false,
      details: { configured: false },
    });
  });
});
