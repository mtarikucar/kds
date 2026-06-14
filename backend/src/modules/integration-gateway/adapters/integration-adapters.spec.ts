import { createHmac } from "node:crypto";
import { GetirAdapter } from "./getir.adapter";
import { TrendyolYemekAdapter } from "./trendyol-yemek.adapter";
import { YemeksepetiAdapter } from "./yemeksepeti.adapter";

/**
 * Integration-gateway delivery adapters: the security-sensitive surface is
 * `parseWebhook` — it MUST reject unsigned/mis-signed payloads (fail-closed)
 * and only normalise after the HMAC-SHA256(body, secret) hex signature
 * matches. These specs pin the branch matrix: missing secret, bad signature,
 * good signature + JSON parse, the per-brand event-type fallback chain, and
 * the JSON-parse swallow path. A regression in any of these would either
 * leak an unauthenticated order event into the domain or drop a valid one.
 */

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("GetirAdapter", () => {
  let adapter: GetirAdapter;
  const secret = "getir-webhook-secret";

  beforeEach(async () => {
    adapter = new GetirAdapter();
    await adapter.init({ vendorToken: "vt", webhookSecret: secret });
  });

  it("healthCheck.ok is true only when vendorToken is present", async () => {
    expect(await adapter.healthCheck()).toEqual({ ok: true });
    const bare = new GetirAdapter();
    await bare.init({});
    expect(await bare.healthCheck()).toEqual({ ok: false });
  });

  it("throws a configuration error when no webhookSecret is set", async () => {
    const bare = new GetirAdapter();
    await bare.init({ vendorToken: "vt" });
    await expect(bare.parseWebhook("anything", "{}")).rejects.toThrow(
      "getir: webhook secret not configured",
    );
  });

  it("rejects a payload whose signature does not match the body", async () => {
    const body = JSON.stringify({ eventName: "order.created" });
    // sign a DIFFERENT body so the digest is valid-hex but wrong.
    const wrongSig = sign(secret, "tampered");
    await expect(adapter.parseWebhook(wrongSig, body)).rejects.toThrow(
      "getir: invalid signature",
    );
  });

  it("accepts a correctly-signed payload and uses eventName as the type", async () => {
    const body = JSON.stringify({ eventName: "order.created", id: 7 });
    const out = await adapter.parseWebhook(sign(secret, body), body);
    expect(out).toEqual([
      {
        providerId: "getir",
        type: "order.created",
        payload: { eventName: "order.created", id: 7 },
      },
    ]);
  });

  it("falls back to order.update when eventName is absent", async () => {
    const body = JSON.stringify({ id: 9 });
    const out = (await adapter.parseWebhook(sign(secret, body), body)) as any[];
    expect(out[0].type).toBe("order.update");
  });

  it("verifies the signature over the raw Buffer body byte-for-byte", async () => {
    const body = JSON.stringify({ eventName: "x" });
    const buf = Buffer.from(body, "utf8");
    const out = (await adapter.parseWebhook(sign(secret, body), buf)) as any[];
    expect(out).toHaveLength(1);
    expect(out[0].providerId).toBe("getir");
  });

  it("returns [] (swallows) when the signature is valid but the body is not JSON", async () => {
    const body = "not-json{";
    const out = await adapter.parseWebhook(sign(secret, body), body);
    expect(out).toEqual([]);
  });
});

describe("TrendyolYemekAdapter", () => {
  let adapter: TrendyolYemekAdapter;
  const apiSecret = "tr-api-secret";

  beforeEach(async () => {
    adapter = new TrendyolYemekAdapter();
    await adapter.init({
      supplierId: "s1",
      apiKey: "k",
      apiSecret,
    });
  });

  it("healthCheck.ok requires BOTH apiKey and apiSecret", async () => {
    expect(await adapter.healthCheck()).toEqual({ ok: true });
    const half = new TrendyolYemekAdapter();
    await half.init({ apiKey: "k" }); // no apiSecret
    expect(await half.healthCheck()).toEqual({ ok: false });
  });

  it("falls back to apiSecret when no dedicated webhookSecret is configured", async () => {
    const body = JSON.stringify({ type: "order.canceled" });
    // signed with apiSecret since webhookSecret is unset
    const out = (await adapter.parseWebhook(
      sign(apiSecret, body),
      body,
    )) as any[];
    expect(out[0]).toMatchObject({
      providerId: "trendyol_yemek",
      type: "order.canceled",
    });
  });

  it("prefers webhookSecret over apiSecret when both are present", async () => {
    const wh = "dedicated-webhook-secret";
    const a = new TrendyolYemekAdapter();
    await a.init({ apiKey: "k", apiSecret, webhookSecret: wh });
    const body = JSON.stringify({ type: "order.update" });
    // a signature made with apiSecret must now be rejected
    await expect(a.parseWebhook(sign(apiSecret, body), body)).rejects.toThrow(
      "trendyol: invalid signature",
    );
    // the webhookSecret signature is accepted
    const out = await a.parseWebhook(sign(wh, body), body);
    expect(out).toHaveLength(1);
  });

  it("throws when neither webhookSecret nor apiSecret is configured", async () => {
    const bare = new TrendyolYemekAdapter();
    await bare.init({ apiKey: "k" }); // apiSecret + webhookSecret both absent
    await expect(bare.parseWebhook("sig", "{}")).rejects.toThrow(
      "trendyol: webhook secret not configured",
    );
  });

  it("defaults type to order.update when the payload omits type", async () => {
    const body = JSON.stringify({ orderId: 1 });
    const out = (await adapter.parseWebhook(
      sign(apiSecret, body),
      body,
    )) as any[];
    expect(out[0].type).toBe("order.update");
  });

  it("returns [] on a signed-but-unparseable body", async () => {
    const body = "<<garbage";
    expect(await adapter.parseWebhook(sign(apiSecret, body), body)).toEqual([]);
  });
});

describe("YemeksepetiAdapter", () => {
  let adapter: YemeksepetiAdapter;
  const secret = "ys-secret";

  beforeEach(async () => {
    adapter = new YemeksepetiAdapter();
    await adapter.init({ apiKey: "k", secret });
  });

  it("healthCheck reports configured details derived from apiKey", async () => {
    expect(await adapter.healthCheck()).toEqual({
      ok: true,
      details: { configured: true },
    });
    const bare = new YemeksepetiAdapter();
    await bare.init({ secret });
    expect(await bare.healthCheck()).toEqual({
      ok: false,
      details: { configured: false },
    });
  });

  it("fails CLOSED when no secret is configured (rejects rather than accepting unsigned)", async () => {
    const bare = new YemeksepetiAdapter();
    await bare.init({ apiKey: "k" }); // no secret
    await expect(bare.parseWebhook("", "{}")).rejects.toThrow(
      "yemeksepeti: webhook secret not configured",
    );
  });

  it("rejects a tampered body under a valid-hex signature", async () => {
    const body = JSON.stringify({ eventType: "order.delivered" });
    const sigForOther = sign(secret, "other-body");
    await expect(adapter.parseWebhook(sigForOther, body)).rejects.toThrow(
      "yemeksepeti: invalid signature",
    );
  });

  it("uses eventType first in the type fallback chain", async () => {
    const body = JSON.stringify({ eventType: "order.delivered", status: "X" });
    const out = (await adapter.parseWebhook(sign(secret, body), body)) as any[];
    expect(out[0].type).toBe("order.delivered");
  });

  it("falls back to status when eventType is absent", async () => {
    const body = JSON.stringify({ status: "PREPARING" });
    const out = (await adapter.parseWebhook(sign(secret, body), body)) as any[];
    expect(out[0].type).toBe("PREPARING");
  });

  it("falls back to order.update when both eventType and status are absent", async () => {
    const body = JSON.stringify({ ref: "abc" });
    const out = (await adapter.parseWebhook(sign(secret, body), body)) as any[];
    expect(out[0]).toEqual({
      providerId: "yemeksepeti",
      type: "order.update",
      payload: { ref: "abc" },
    });
  });

  it("accepts a sha256=-prefixed signature (verifyHmacHex strips the wrapper)", async () => {
    const body = JSON.stringify({ eventType: "order.update" });
    const prefixed = "sha256=" + sign(secret, body);
    const out = await adapter.parseWebhook(prefixed, body);
    expect(out).toHaveLength(1);
  });

  it("syncOrderStatus resolves without throwing (stubbed surface)", async () => {
    await expect(
      adapter.syncOrderStatus("o1", "DELIVERED"),
    ).resolves.toBeUndefined();
  });
});
