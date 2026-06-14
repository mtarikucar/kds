import { Request } from "express";
import {
  getClientIp,
  isPrivateIp,
  getProductionSafeIp,
} from "./ip-detection.util";

/**
 * Long-tail spec for the richer proxy-aware IP detection used by the QR
 * menu / public surface. Priority order is load-bearing:
 * CF-Connecting-IP > X-Real-IP > X-Forwarded-For > X-Client-IP > socket.
 * Each header is validated with net.isIP so a forged garbage header
 * doesn't poison the result.
 */
describe("ip-detection.util", () => {
  const make = (
    headers: Record<string, string | string[]> = {},
    socketIp?: string,
  ): Request =>
    ({ headers, socket: { remoteAddress: socketIp } } as unknown as Request);

  describe("getClientIp priority", () => {
    it("prefers a valid CF-Connecting-IP over everything else", () => {
      const req = make({
        "cf-connecting-ip": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
        "x-forwarded-for": "9.9.9.9",
      });
      expect(getClientIp(req)).toBe("1.2.3.4");
    });

    it("skips an invalid CF header and falls through to X-Real-IP", () => {
      const req = make({
        "cf-connecting-ip": "not-an-ip",
        "x-real-ip": "5.6.7.8",
      });
      expect(getClientIp(req)).toBe("5.6.7.8");
    });

    it("uses the left-most X-Forwarded-For hop", () => {
      const req = make({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
      expect(getClientIp(req)).toBe("9.9.9.9");
    });

    it("strips the ::ffff: prefix from an IPv4-mapped socket address", () => {
      const req = make({}, "::ffff:192.0.2.5");
      expect(getClientIp(req)).toBe("192.0.2.5");
    });

    it("returns 0.0.0.0 when nothing is resolvable", () => {
      expect(getClientIp(make({}))).toBe("0.0.0.0");
    });
  });

  describe("isPrivateIp", () => {
    it.each([
      ["10.0.0.1", true],
      ["172.16.5.5", true],
      ["172.31.255.255", true],
      ["192.168.1.1", true],
      ["127.0.0.1", true],
      ["::1", true],
      ["fe80::1", true],
      ["fd00::1", true],
      ["8.8.8.8", false],
      ["172.32.0.1", false],
      ["203.0.113.1", false],
    ])("classifies %s as private=%s", (ip, expected) => {
      expect(isPrivateIp(ip as string)).toBe(expected);
    });
  });

  describe("getProductionSafeIp", () => {
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = prevEnv;
      jest.restoreAllMocks();
    });

    it("warns when a private IP is detected in production", () => {
      process.env.NODE_ENV = "production";
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      const ip = getProductionSafeIp(make({ "x-real-ip": "10.0.0.9" }));
      expect(ip).toBe("10.0.0.9");
      expect(warn).toHaveBeenCalled();
    });

    it("does not warn for a public IP", () => {
      process.env.NODE_ENV = "production";
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      getProductionSafeIp(make({ "x-real-ip": "8.8.8.8" }));
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
