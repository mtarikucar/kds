import axios from "axios";
import { GeolocationService } from "./geolocation.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * GeolocationService resolves a visitor IP to country/city via the ip-api.com
 * HTTP provider. These specs lock the non-trivial behaviours:
 *   - local/internal IPs are never sent to the third party (privacy + noise),
 *   - successful lookups are mapped + cached (and the cache is HIT, not re-fetched),
 *   - failed / non-"success" lookups are SWALLOWED (never throw) and negatively
 *     cached so a dead provider doesn't get hammered,
 *   - the raw IP is the cache KEY only; the provider URL carries the IP but a
 *     failure log masks it (no raw IP in logs).
 */
describe("GeolocationService", () => {
  let svc: GeolocationService;

  const sampleGeo = {
    status: "success",
    country: "Turkey",
    countryCode: "TR",
    region: "34",
    city: "Istanbul",
    lat: 41.0,
    lon: 29.0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new GeolocationService();
  });

  describe("local / internal IPs", () => {
    // Behaviour: localhost + RFC-1918 ranges short-circuit to null and the
    // outbound HTTP provider is NEVER contacted.
    it.each([
      "127.0.0.1",
      "::1",
      "localhost",
      "192.168.1.10",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.254",
    ])("returns null without any HTTP call for local IP %s", async (ip) => {
      const result = await svc.lookup(ip);
      expect(result).toBeNull();
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  describe("successful lookup", () => {
    it("maps the provider payload to GeoData", async () => {
      mockedAxios.get.mockResolvedValue({ data: sampleGeo });

      const result = await svc.lookup("8.8.8.8");

      expect(result).toEqual({
        country: "Turkey",
        countryCode: "TR",
        region: "34",
        city: "Istanbul",
        latitude: 41.0,
        longitude: 29.0,
      });
    });

    it("requests the public ip-api endpoint with the looked-up IP", async () => {
      mockedAxios.get.mockResolvedValue({ data: sampleGeo });

      await svc.lookup("8.8.8.8");

      const url = mockedAxios.get.mock.calls[0][0] as string;
      expect(url).toContain("ip-api.com");
      expect(url).toContain("8.8.8.8");
    });

    it("caches a success and serves the second call from cache (no 2nd HTTP call)", async () => {
      mockedAxios.get.mockResolvedValue({ data: sampleGeo });

      const first = await svc.lookup("8.8.8.8");
      const second = await svc.lookup("8.8.8.8");

      expect(first).toEqual(second);
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("re-queries once the cached entry exceeds the 24h TTL", async () => {
      mockedAxios.get.mockResolvedValue({ data: sampleGeo });
      const nowSpy = jest.spyOn(Date, "now");

      // First lookup at t0 -> cached with timestamp t0.
      nowSpy.mockReturnValue(0);
      await svc.lookup("8.8.8.8");

      // Past the 24h TTL -> cache is stale, provider hit again.
      nowSpy.mockReturnValue(25 * 60 * 60 * 1000);
      await svc.lookup("8.8.8.8");

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });
  });

  describe("failure resilience (must not throw)", () => {
    it("returns null and does NOT throw when the provider errors", async () => {
      mockedAxios.get.mockRejectedValue(new Error("ECONNRESET"));

      await expect(svc.lookup("8.8.8.8")).resolves.toBeNull();
    });

    it("does not leak the raw IP into the warning log on failure (masks it)", async () => {
      mockedAxios.get.mockRejectedValue(new Error("ECONNRESET"));
      const warnSpy = jest
        .spyOn((svc as any).logger, "warn")
        .mockImplementation(() => undefined);

      await svc.lookup("203.0.113.42");

      const logged = warnSpy.mock.calls[0][0] as string;
      expect(logged).not.toContain("203.0.113.42");
      // /16 grain is retained for ISP-block debugging.
      expect(logged).toContain("203.0.x.x");
    });

    it("negatively caches a failure so the dead provider is not re-hit", async () => {
      mockedAxios.get.mockRejectedValue(new Error("ECONNRESET"));

      const first = await svc.lookup("8.8.8.8");
      const second = await svc.lookup("8.8.8.8");

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    it("treats a non-success provider status as a null lookup (and caches it)", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { status: "fail", message: "reserved range" },
      });

      const first = await svc.lookup("8.8.8.8");
      const second = await svc.lookup("8.8.8.8");

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("cleanCache", () => {
    it("evicts entries older than the TTL but keeps fresh ones", async () => {
      mockedAxios.get.mockResolvedValue({ data: sampleGeo });
      const nowSpy = jest.spyOn(Date, "now");

      nowSpy.mockReturnValue(0);
      await svc.lookup("8.8.8.8"); // stale entry, timestamp 0

      nowSpy.mockReturnValue(25 * 60 * 60 * 1000);
      await svc.lookup("9.9.9.9"); // fresh entry, timestamp 25h

      // cleanCache runs "now" = 25h: 8.8.8.8 (age 25h) evicted, 9.9.9.9 kept.
      svc.cleanCache();

      // 8.8.8.8 must be re-fetched (evicted); 9.9.9.9 still cached.
      mockedAxios.get.mockClear();
      await svc.lookup("9.9.9.9");
      expect(mockedAxios.get).not.toHaveBeenCalled();

      await svc.lookup("8.8.8.8");
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);

      nowSpy.mockRestore();
    });
  });
});
