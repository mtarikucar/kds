// class-validator decorators need the Reflect polyfill; in app code
// @nestjs/core loads it, but this spec imports the validator standalone.
import "reflect-metadata";
import { validate } from "./env.validation";

describe("env validation (typed layer — secrets are owned by common/helpers/env-validation.ts)", () => {
  it("accepts an empty env (secret presence is the boot validator's job)", () => {
    expect(() => validate({})).not.toThrow();
  });

  it("accepts every known NODE_ENV", () => {
    for (const env of ["development", "production", "test", "staging"]) {
      expect(() => validate({ NODE_ENV: env })).not.toThrow();
    }
  });

  it("rejects an unknown NODE_ENV (catches NODE_ENV=prod)", () => {
    expect(() => validate({ NODE_ENV: "prod" })).toThrow(/NODE_ENV/);
  });

  it("coerces and bounds-checks PORT", () => {
    expect(validate({ PORT: "3000" }).PORT).toBe(3000);
    expect(() => validate({ PORT: "0" })).toThrow(/PORT/);
    expect(() => validate({ PORT: "99999" })).toThrow(/PORT/);
    expect(() => validate({ PORT: "not-a-number" })).toThrow(/PORT/);
  });

  it("type-checks URL-shaped optionals when present", () => {
    expect(() =>
      validate({ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" }),
    ).toThrow(/OTEL_EXPORTER_OTLP_ENDPOINT/);
    expect(() =>
      validate({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel-collector:4318" }),
    ).not.toThrow();
  });

  // Regression: a blank OTEL_EXPORTER_OTLP_ENDPOINT= placeholder in the
  // staging .env crash-looped the backend on 2026-06-11 (health probe
  // timeout -> rollback). Blank string must mean "unset", matching the
  // boot validator's `!value || value.trim() === ""` semantics.
  it("treats blank strings as unset for every optional (VAR= placeholders)", () => {
    expect(() =>
      validate({
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        REDIS_URL: "",
        PORT: "",
        METRICS_TOKEN: "  ",
        NODE_ENV: "staging",
      }),
    ).not.toThrow();
  });

  it("still type-checks REDIS_URL when actually set", () => {
    expect(() =>
      validate({ REDIS_URL: "redis://redis:6379/2" }),
    ).not.toThrow();
  });

  it("aggregates every invalid variable into one error", () => {
    let message = "";
    try {
      validate({ NODE_ENV: "prod", PORT: "0" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("NODE_ENV");
    expect(message).toContain("PORT");
  });
});
