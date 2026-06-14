import type { Request } from "express";
import { getClientIp } from "./client-ip.helper";

/**
 * Long-tail spec for audit/rate-limit IP resolution. The load-bearing
 * contracts: (1) Express's already-trusted req.ip wins; (2) when absent,
 * only the LEFT-MOST X-Forwarded-For hop is used (the rest are proxies);
 * (3) array-form header is handled; (4) nothing usable → undefined.
 */
describe("getClientIp (client-ip.helper)", () => {
  const make = (over: Partial<Request>): Request =>
    ({ headers: {}, ...over } as unknown as Request);

  it("prefers req.ip when set (trust-proxy already resolved it)", () => {
    const req = make({
      ip: "203.0.113.9",
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.9");
  });

  it("takes only the left-most XFF hop when req.ip is absent", () => {
    const req = make({
      ip: undefined,
      headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1, 10.0.0.2" },
    });
    expect(getClientIp(req)).toBe("198.51.100.1");
  });

  it("handles an array-form x-forwarded-for header", () => {
    const req = make({
      ip: undefined,
      headers: { "x-forwarded-for": ["198.51.100.7, 10.0.0.1"] },
    });
    expect(getClientIp(req)).toBe("198.51.100.7");
  });

  it("returns undefined when neither req.ip nor XFF is present", () => {
    expect(getClientIp(make({ ip: undefined, headers: {} }))).toBeUndefined();
  });

  it("returns undefined for an empty XFF string", () => {
    const req = make({ ip: undefined, headers: { "x-forwarded-for": "   " } });
    expect(getClientIp(req)).toBeUndefined();
  });
});
