import { MockDataGeneratorService } from "./mock-data-generator.service";
import { PrismaService } from "../../../prisma/prisma.service";
import { PersonState } from "../enums/analytics.enum";

/**
 * Long-tail spec for the demo-data generator's deterministic helpers (the
 * Math.random-free parts). getActivityLevel encodes the restaurant traffic
 * curve (closed overnight, lunch/dinner peaks, weekend uplift);
 * selectRandomTables sizes the active set by activity; generateOccupancyPoint
 * keeps positions/confidence within physical bounds.
 */
describe("MockDataGeneratorService helpers", () => {
  const svc = new MockDataGeneratorService({} as PrismaService);
  const activity = (h: number, d: number): number =>
    (svc as any).getActivityLevel(h, d);

  describe("getActivityLevel", () => {
    it("is zero overnight (before 10:00 and from 23:00)", () => {
      expect(activity(3, 2)).toBe(0);
      expect(activity(23, 2)).toBe(0);
    });

    it("peaks at lunch and dinner on a weekday", () => {
      expect(activity(13, 2)).toBeCloseTo(0.8); // lunch
      expect(activity(20, 2)).toBeCloseTo(1.0); // dinner peak
    });

    it("applies the 1.3x weekend multiplier", () => {
      const weekday = activity(20, 2); // Tuesday
      const weekend = activity(20, 6); // Saturday
      expect(weekend).toBeCloseTo(weekday * 1.3);
    });
  });

  describe("selectRandomTables", () => {
    const tables = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      number: String(i),
      capacity: 4,
    }));

    it("selects floor(count * activity) tables", () => {
      const half = (svc as any).selectRandomTables(tables, 0.5);
      expect(half).toHaveLength(5);
    });

    it("selects none at zero activity and all at full activity", () => {
      expect((svc as any).selectRandomTables(tables, 0)).toHaveLength(0);
      expect((svc as any).selectRandomTables(tables, 1)).toHaveLength(10);
    });
  });

  describe("generateOccupancyPoint", () => {
    it("stays within physical position offsets and a valid confidence band", () => {
      const table = { id: "t1", number: "1", capacity: 4 };
      for (let i = 0; i < 50; i += 1) {
        const p = (svc as any).generateOccupancyPoint(table, `trk-${i}`);
        expect(Math.abs(p.positionX)).toBeLessThanOrEqual(0.75);
        expect(Math.abs(p.positionZ)).toBeLessThanOrEqual(0.75);
        expect(p.confidence).toBeGreaterThanOrEqual(0.85);
        expect(p.confidence).toBeLessThanOrEqual(1);
        expect([PersonState.SITTING, PersonState.STANDING]).toContain(p.state);
        expect(p.tableId).toBe("t1");
      }
    });
  });
});
