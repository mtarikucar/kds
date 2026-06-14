import { getTenantMidnight, getTenantDayBounds } from "./timezone.helper";

/**
 * Long-tail spec for tenant-local day boundaries. The load-bearing
 * contracts: (1) midnight in a non-UTC zone is the correct UTC instant,
 * not server-local midnight; (2) an unknown tz string falls back to
 * server-local midnight instead of throwing so one bad tenant config
 * can't break the feature; (3) day bounds span exactly 24h.
 */
describe("timezone.helper", () => {
  describe("getTenantMidnight", () => {
    it("returns the UTC instant of Istanbul midnight (UTC+3) for an afternoon time", () => {
      // 2026-06-14T10:00Z is 13:00 in Istanbul → that day's midnight is
      // 2026-06-13T21:00Z (00:00 Istanbul == 21:00 prev-day UTC).
      const now = new Date("2026-06-14T10:00:00Z");
      const mid = getTenantMidnight(now, "Europe/Istanbul");
      expect(mid.toISOString()).toBe("2026-06-13T21:00:00.000Z");
    });

    it("returns plain UTC midnight when the timezone is UTC", () => {
      const now = new Date("2026-06-14T10:00:00Z");
      const mid = getTenantMidnight(now, "UTC");
      expect(mid.toISOString()).toBe("2026-06-14T00:00:00.000Z");
    });

    it("falls back to server-local midnight for an unknown timezone (no throw)", () => {
      const now = new Date("2026-06-14T10:00:00Z");
      const mid = getTenantMidnight(now, "Not/AZone");
      // fallback uses setHours(0,0,0,0) in the server's local zone.
      const expected = new Date(now);
      expected.setHours(0, 0, 0, 0);
      expect(mid.getTime()).toBe(expected.getTime());
    });
  });

  describe("getTenantDayBounds", () => {
    it("spans exactly 24 hours for a UTC date", () => {
      const { start, end } = getTenantDayBounds("2026-06-14", "UTC");
      expect(start.toISOString()).toBe("2026-06-14T00:00:00.000Z");
      expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("anchors start at Istanbul midnight (prev-day 21:00Z)", () => {
      const { start, end } = getTenantDayBounds("2026-06-14", "Europe/Istanbul");
      expect(start.toISOString()).toBe("2026-06-13T21:00:00.000Z");
      expect(end.toISOString()).toBe("2026-06-14T21:00:00.000Z");
    });
  });
});
