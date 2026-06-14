import { stripCorrelationMeta } from "./outbox.service";

describe("stripCorrelationMeta", () => {
  it("removes the _meta envelope before a payload crosses a trust boundary", () => {
    const out = stripCorrelationMeta({
      orderId: "o-1",
      totalCents: 12345,
      _meta: { requestId: "req-abc" },
    });
    expect(out).toEqual({ orderId: "o-1", totalCents: 12345 });
    expect(out).not.toHaveProperty("_meta");
  });

  it("leaves a payload without _meta byte-identical (no behaviour change)", () => {
    const payload = { orderId: "o-1", totalCents: 12345 };
    expect(stripCorrelationMeta(payload)).toEqual(payload);
  });

  it("is null/undefined-safe (purged source payload)", () => {
    expect(stripCorrelationMeta(null)).toBeNull();
    expect(stripCorrelationMeta(undefined)).toBeUndefined();
  });
});
