import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateZReportDto } from "./create-z-report.dto";
import { QueryZReportDto } from "./query-z-report.dto";

/**
 * Long-tail validation spec for the Z-Report DTOs. Load-bearing rules:
 * reportDate ISO + non-negative cash balances on create; query pagination
 * is clamped (page>=1, limit 1–100) and empty-string dates coerce to
 * undefined.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe("CreateZReportDto", () => {
  const base = {
    reportDate: "2026-06-14",
    cashDrawerOpening: 100,
    cashDrawerClosing: 250,
  };

  it("accepts a valid report", async () => {
    expect(await errs(plainToInstance(CreateZReportDto, base))).toEqual([]);
  });

  it("rejects a non-ISO reportDate", async () => {
    const dto = plainToInstance(CreateZReportDto, {
      ...base,
      reportDate: "14/06/2026",
    });
    expect((await errs(dto)).some((m) => /reportDate/.test(m))).toBe(true);
  });

  it("rejects a negative opening balance", async () => {
    const dto = plainToInstance(CreateZReportDto, {
      ...base,
      cashDrawerOpening: -1,
    });
    expect((await errs(dto)).some((m) => /cashDrawerOpening/.test(m))).toBe(
      true,
    );
  });
});

describe("QueryZReportDto", () => {
  it("coerces numeric strings and accepts in-range paging", async () => {
    const dto = plainToInstance(QueryZReportDto, { page: "2", limit: "50" });
    expect(await errs(dto)).toEqual([]);
    expect(dto.page).toBe(2);
    expect(dto.limit).toBe(50);
  });

  it("rejects a limit above 100", async () => {
    const dto = plainToInstance(QueryZReportDto, { limit: "200" });
    expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
  });

  it("rejects page < 1", async () => {
    const dto = plainToInstance(QueryZReportDto, { page: "0" });
    expect((await errs(dto)).some((m) => /page/.test(m))).toBe(true);
  });

  it("coerces empty-string dates to undefined", async () => {
    const dto = plainToInstance(QueryZReportDto, { startDate: "", endDate: "" });
    expect(await errs(dto)).toEqual([]);
    expect(dto.startDate).toBeUndefined();
  });
});
