import { bootstrapTracing, withSpan } from "./tracing";

/**
 * Long-tail spec for the opt-in OTel tracing bootstrap. Load-bearing
 * contract: OTel is strictly additive and OFF by default — when
 * OTEL_EXPORTER_OTLP_ENDPOINT is unset, bootstrapTracing returns without
 * touching the SDK and withSpan is a transparent pass-through that returns
 * the wrapped function's value (and propagates its rejection) with zero
 * runtime cost.
 */
describe("observability/tracing (disabled path)", () => {
  const prev = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  beforeEach(() => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = prev;
  });

  it("bootstrapTracing returns early (no throw) when the endpoint is unset", async () => {
    await expect(bootstrapTracing()).resolves.toBeUndefined();
  });

  it("withSpan transparently returns the wrapped value when disabled", async () => {
    const fn = jest.fn().mockResolvedValue(42);
    await expect(withSpan("op", { k: "v" }, fn)).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("withSpan propagates the wrapped function's rejection when disabled", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("inner"));
    await expect(withSpan("op", {}, fn)).rejects.toThrow("inner");
  });
});
