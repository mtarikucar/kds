import { createHmac } from "node:crypto";
import { GetirLiveAdapter } from "./getir-live.adapter";

/**
 * GetirLiveAdapter — REAL HTTP merchant-API adapter.
 *
 * Two surfaces under test:
 *   1. parseWebhook fail-closed HMAC gate (mirrors the scaffold spec matrix:
 *      missing secret, bad signature, good signature + JSON parse, eventName
 *      fallback, raw-Buffer body, JSON-parse swallow).
 *   2. The live HTTP calls (auth → token cache, pull, ack/reject, status
 *      push, availability) against a mocked global.fetch — asserting URL,
 *      method, auth header, body, and that credentials are read from config
 *      (never hardcoded).
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

describe("GetirLiveAdapter", () => {
  let adapter: GetirLiveAdapter;
  const secret = "getir-webhook-secret";
  const creds = {
    appSecretKey: "app-secret",
    restaurantSecretKey: "rest-secret",
    restaurantId: "r1",
    webhookSecret: secret,
  };

  beforeEach(async () => {
    adapter = new GetirLiveAdapter();
    await adapter.init(creds);
  });

  // -- identity / schema --------------------------------------------------

  it("exposes a delivery-kind id distinct from the scaffold", () => {
    expect(adapter.id).toBe("getir_live");
    expect(adapter.kind).toBe("delivery");
    expect(adapter.configSchema).toMatchObject({
      required: ["appSecretKey", "restaurantSecretKey"],
    });
  });

  // -- webhook gate -------------------------------------------------------

  it("throws when no webhookSecret is configured (fail-closed)", async () => {
    const bare = new GetirLiveAdapter();
    await bare.init({ appSecretKey: "a", restaurantSecretKey: "b" });
    await expect(bare.parseWebhook("sig", "{}")).rejects.toThrow(
      "getir: webhook secret not configured",
    );
  });

  it("rejects a signature that does not match the body", async () => {
    const body = JSON.stringify({ eventName: "order.created" });
    await expect(
      adapter.parseWebhook(sign(secret, "tampered"), body),
    ).rejects.toThrow("getir: invalid signature");
  });

  it("accepts a correctly-signed payload and uses eventName as the type", async () => {
    const body = JSON.stringify({ eventName: "order.created", id: 7 });
    const out = await adapter.parseWebhook(sign(secret, body), body);
    expect(out).toEqual([
      {
        providerId: "getir_live",
        type: "order.created",
        payload: { eventName: "order.created", id: 7 },
      },
    ]);
  });

  it("falls back to order.update when eventName is absent", async () => {
    const body = JSON.stringify({ id: 9 });
    const out = await adapter.parseWebhook(sign(secret, body), body);
    expect(out[0].type).toBe("order.update");
  });

  it("verifies the signature over a raw Buffer body", async () => {
    const body = JSON.stringify({ eventName: "x" });
    const out = await adapter.parseWebhook(
      sign(secret, body),
      Buffer.from(body, "utf8"),
    );
    expect(out[0].providerId).toBe("getir_live");
  });

  it("returns [] when the signature is valid but the body is not JSON", async () => {
    const body = "not-json{";
    expect(await adapter.parseWebhook(sign(secret, body), body)).toEqual([]);
  });

  // -- HTTP: auth + token cache ------------------------------------------

  it("logs in with the configured secrets and bearers subsequent calls", async () => {
    const f = installFetch((url) => {
      if (url.endsWith("/auth/login")) return { token: "tok-123" };
      return {};
    });
    try {
      await adapter.acknowledgeOrder("o1");
      const login = f.calls[0];
      expect(login.url).toBe("https://food-external-api.getir.com/auth/login");
      expect(JSON.parse(login.init.body as string)).toEqual({
        appSecretKey: "app-secret",
        restaurantSecretKey: "rest-secret",
      });
      const verify = f.calls[1];
      expect(verify.url).toBe(
        "https://food-external-api.getir.com/food-orders/o1/verify",
      );
      expect(verify.init.method).toBe("POST");
      expect((verify.init.headers as any).Authorization).toBe("Bearer tok-123");
    } finally {
      f.restore();
    }
  });

  it("caches the token across calls (logs in only once)", async () => {
    const f = installFetch((url) =>
      url.endsWith("/auth/login") ? { token: "tok" } : {},
    );
    try {
      await adapter.acknowledgeOrder("o1");
      await adapter.acknowledgeOrder("o2");
      const logins = f.calls.filter((c) => c.url.endsWith("/auth/login"));
      expect(logins).toHaveLength(1);
    } finally {
      f.restore();
    }
  });

  it("throws on a non-OK HTTP response", async () => {
    const real = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue("unauthorized"),
    })) as any;
    try {
      await expect(adapter.acknowledgeOrder("o1")).rejects.toThrow(/401/);
    } finally {
      global.fetch = real;
    }
  });

  // -- HTTP: pull / reject / status / availability -----------------------

  it("pulls unapproved orders", async () => {
    const f = installFetch((url) => {
      if (url.endsWith("/auth/login")) return { token: "t" };
      if (url.endsWith("/food-orders/periodic/unapproved"))
        return { orders: [{ id: "x" }] };
      return {};
    });
    try {
      const orders = await adapter.pullOrders();
      expect(orders).toEqual([{ id: "x" }]);
    } finally {
      f.restore();
    }
  });

  it("rejects an order with a reason", async () => {
    const f = installFetch((url) =>
      url.endsWith("/auth/login") ? { token: "t" } : {},
    );
    try {
      await adapter.rejectOrder("o9", "sold out");
      const call = f.calls.find((c) =>
        c.url.endsWith("/food-orders/o9/cancel"),
      );
      expect(JSON.parse(call!.init.body as string)).toEqual({
        rejectReason: "sold out",
      });
    } finally {
      f.restore();
    }
  });

  it("maps a status onto the correct Getir endpoint", async () => {
    const f = installFetch((url) =>
      url.endsWith("/auth/login") ? { token: "t" } : {},
    );
    try {
      await adapter.syncOrderStatus("o1", "PREPARING");
      expect(
        f.calls.some((c) => c.url.endsWith("/food-orders/o1/prepare")),
      ).toBe(true);
    } finally {
      f.restore();
    }
  });

  it("treats an unmapped status as a no-op (no upstream call)", async () => {
    const f = installFetch((url) =>
      url.endsWith("/auth/login") ? { token: "t" } : {},
    );
    try {
      await adapter.syncOrderStatus("o1", "PICKED_UP");
      // only the login (token warm-up) — no status endpoint hit
      expect(f.calls.some((c) => c.url.includes("/food-orders/"))).toBe(false);
    } finally {
      f.restore();
    }
  });

  it("opens/closes a product via the availability endpoint", async () => {
    const f = installFetch((url) =>
      url.endsWith("/auth/login") ? { token: "t" } : {},
    );
    try {
      await adapter.setProductAvailability("p1", false);
      const call = f.calls.find((c) =>
        c.url.endsWith("/food-products/p1/status"),
      );
      expect(call!.init.method).toBe("PUT");
      expect(JSON.parse(call!.init.body as string)).toEqual({
        isActive: false,
      });
    } finally {
      f.restore();
    }
  });

  // -- healthCheck --------------------------------------------------------

  it("healthCheck is false (not thrown) when unconfigured", async () => {
    const bare = new GetirLiveAdapter();
    await bare.init({});
    expect(await bare.healthCheck()).toEqual({
      ok: false,
      details: { configured: false },
    });
  });

  it("healthCheck is true when login succeeds", async () => {
    const f = installFetch(() => ({ token: "t" }));
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
