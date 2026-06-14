import { numericEnv } from "./numeric-env.util";

describe("numericEnv", () => {
  it("returns the fallback when the value is missing", () => {
    expect(numericEnv(undefined, 30)).toBe(30);
    expect(numericEnv(null, 30)).toBe(30);
    expect(numericEnv("", 30)).toBe(30);
  });

  it("coerces a numeric STRING (the real env-var path) to a number", () => {
    // ConfigService returns the raw string for an env-set var; this is the
    // exact path that previously produced `new Date(Date.now() + "5000")`.
    expect(numericEnv("5000", 30)).toBe(5000);
    expect(typeof numericEnv("5000", 30)).toBe("number");
  });

  it("passes a real number through unchanged", () => {
    expect(numericEnv(86400000, 30)).toBe(86400000);
  });

  it("falls back on non-finite / non-numeric / negative input (never breaks arithmetic)", () => {
    expect(numericEnv("not-a-number", 30)).toBe(30);
    expect(numericEnv("NaN", 30)).toBe(30);
    expect(numericEnv(NaN, 30)).toBe(30);
    expect(numericEnv(Infinity, 30)).toBe(30);
    expect(numericEnv("-100", 30)).toBe(30);
  });

  it("a coerced TTL produces a valid Date (regression: string concat -> Invalid Date)", () => {
    const ttl = numericEnv("60000", 1000);
    const d = new Date(Date.now() + ttl);
    expect(Number.isNaN(d.getTime())).toBe(false);
    // string concat would have thrown / produced Invalid Date here
    expect(() => d.toISOString()).not.toThrow();
  });
});
