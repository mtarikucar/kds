import {
  calculateDistance,
  isLocationWithinRange,
  isValidCoordinates,
} from "./geolocation.util";

/**
 * Long-tail spec for QR-menu geofencing. calculateDistance is a Haversine
 * implementation; the load-bearing contracts are: identical points → 0m,
 * a known city-pair distance is within tolerance, range check is inclusive
 * at the boundary, and coordinate validation rejects out-of-range / nullish.
 */
describe("geolocation.util", () => {
  describe("calculateDistance", () => {
    it("returns 0 for identical coordinates", () => {
      expect(calculateDistance(41.0, 29.0, 41.0, 29.0)).toBe(0);
    });

    it("matches a known distance (Istanbul→Ankara ≈ 350km) within 5%", () => {
      // Istanbul (41.0082, 28.9784) → Ankara (39.9334, 32.8597)
      const d = calculateDistance(41.0082, 28.9784, 39.9334, 32.8597);
      const km = d / 1000;
      expect(km).toBeGreaterThan(330);
      expect(km).toBeLessThan(370);
    });

    it("is symmetric (A→B equals B→A)", () => {
      const ab = calculateDistance(41, 29, 39, 32);
      const ba = calculateDistance(39, 32, 41, 29);
      expect(ab).toBeCloseTo(ba, 6);
    });
  });

  describe("isLocationWithinRange", () => {
    it("reports in-range and a rounded distance for a co-located customer", () => {
      const r = isLocationWithinRange(41, 29, 41, 29, 50);
      expect(r).toEqual({ isWithinRange: true, distance: 0 });
    });

    it("is inclusive at the exact boundary", () => {
      // ~111m north (0.001 deg lat). Allow exactly that distance.
      const r = isLocationWithinRange(41.0, 29.0, 41.001, 29.0, r0Distance());
      expect(r.isWithinRange).toBe(true);
    });

    it("reports out-of-range when beyond the radius", () => {
      const r = isLocationWithinRange(41.0, 29.0, 41.01, 29.0, 50);
      expect(r.isWithinRange).toBe(false);
      expect(r.distance).toBeGreaterThan(50);
    });

    function r0Distance(): number {
      return calculateDistance(41.0, 29.0, 41.001, 29.0);
    }
  });

  describe("isValidCoordinates", () => {
    it("accepts in-range coordinates", () => {
      expect(isValidCoordinates(41, 29)).toBe(true);
      expect(isValidCoordinates(-90, -180)).toBe(true);
      expect(isValidCoordinates(90, 180)).toBe(true);
    });

    it("rejects out-of-range latitude/longitude", () => {
      expect(isValidCoordinates(91, 0)).toBe(false);
      expect(isValidCoordinates(0, 181)).toBe(false);
      expect(isValidCoordinates(-91, 0)).toBe(false);
    });

    it("rejects null/undefined", () => {
      expect(isValidCoordinates(null, 0)).toBe(false);
      expect(isValidCoordinates(0, undefined)).toBe(false);
      expect(isValidCoordinates(undefined, undefined)).toBe(false);
    });
  });
});
