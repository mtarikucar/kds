import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  DateRangeQueryDto,
  TopProductsQueryDto,
  SingleDateQueryDto,
} from "./query.dto";
import { DateRangeDto } from "./date-range.dto";

/**
 * Long-tail validation spec for the report query DTOs. Load-bearing rules:
 * branchId must be a UUID (a typo used to silently filter to zero rows —
 * now 400); dates must be ISO; empty-string query params coerce to
 * undefined (HTML forms submit ""); the top-products limit is clamped to
 * the [1,100] integer range.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("reports query DTOs", () => {
  describe("DateRangeQueryDto", () => {
    it("accepts ISO dates + a UUID branchId", async () => {
      const dto = plainToInstance(DateRangeQueryDto, {
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        branchId: "0c4612e8-18e6-4f16-9edd-844f9369edc7",
      });
      expect(await errs(dto)).toEqual([]);
    });

    it("coerces empty-string params to undefined (no validation error)", async () => {
      const dto = plainToInstance(DateRangeQueryDto, {
        startDate: "",
        endDate: "",
        branchId: "",
      });
      expect(await errs(dto)).toEqual([]);
      expect(dto.startDate).toBeUndefined();
      expect(dto.branchId).toBeUndefined();
    });

    it("rejects a non-UUID branchId (zero-rows footgun guard)", async () => {
      const dto = plainToInstance(DateRangeQueryDto, { branchId: "main" });
      expect((await errs(dto)).some((m) => /branchId/.test(m))).toBe(true);
    });

    it("rejects a non-ISO startDate", async () => {
      const dto = plainToInstance(DateRangeQueryDto, { startDate: "yesterday" });
      expect((await errs(dto)).some((m) => /startDate/.test(m))).toBe(true);
    });
  });

  describe("TopProductsQueryDto", () => {
    it("coerces a numeric-string limit and accepts it in range", async () => {
      const dto = plainToInstance(TopProductsQueryDto, { limit: "25" });
      expect(await errs(dto)).toEqual([]);
      expect(dto.limit).toBe(25);
    });

    it("rejects a limit above the 100 cap", async () => {
      const dto = plainToInstance(TopProductsQueryDto, { limit: "101" });
      expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
    });

    it("rejects a limit below 1", async () => {
      const dto = plainToInstance(TopProductsQueryDto, { limit: "0" });
      expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
    });
  });

  describe("SingleDateQueryDto", () => {
    it("accepts an ISO date + UUID branch and rejects a bad branch", async () => {
      expect(
        await errs(plainToInstance(SingleDateQueryDto, { date: "2026-04-15" })),
      ).toEqual([]);
      const bad = plainToInstance(SingleDateQueryDto, { branchId: "x" });
      expect((await errs(bad)).some((m) => /branchId/.test(m))).toBe(true);
    });
  });

  describe("DateRangeDto", () => {
    it("accepts ISO datetimes and rejects junk", async () => {
      expect(
        await errs(
          plainToInstance(DateRangeDto, {
            startDate: "2025-01-01T00:00:00Z",
            endDate: "2025-12-31T23:59:59Z",
          }),
        ),
      ).toEqual([]);
      const bad = plainToInstance(DateRangeDto, { startDate: "nope" });
      expect((await errs(bad)).length).toBeGreaterThan(0);
    });
  });
});
