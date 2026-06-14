import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { ClockInDto } from "./clock-in.dto";
import { CreateShiftTemplateDto } from "./create-shift-template.dto";
import { AssignShiftDto, BulkAssignShiftDto } from "./assign-shift.dto";
import { AttendanceQueryDto } from "./attendance-query.dto";
import { AttendanceStatus } from "../constants/personnel.enum";

/**
 * Long-tail validation spec for the personnel DTOs. Load-bearing rules:
 * shift template start/end are HH:mm (a malformed time breaks the
 * scheduler's overlap math), color is a #RRGGBB hex, clock-in notes are
 * capped (payroll/audit column), bulk-assign validates each nested
 * assignment, and the attendance query status is a closed enum with
 * clamped pagination.
 */
function flatten(es: ValidationError[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...flatten(e.children ?? []),
  ]);
}
async function errs(dto: object): Promise<string[]> {
  return flatten(await validate(dto));
}

describe("CreateShiftTemplateDto", () => {
  const base = { name: "Morning", startTime: "09:00", endTime: "17:00" };

  it("accepts a valid template", async () => {
    expect(await errs(plainToInstance(CreateShiftTemplateDto, base))).toEqual([]);
  });

  it("rejects a malformed start time", async () => {
    const dto = plainToInstance(CreateShiftTemplateDto, {
      ...base,
      startTime: "25:99",
    });
    expect((await errs(dto)).some((m) => /startTime/.test(m))).toBe(true);
  });

  it("rejects a non-hex color", async () => {
    const dto = plainToInstance(CreateShiftTemplateDto, {
      ...base,
      color: "red",
    });
    expect((await errs(dto)).some((m) => /color/.test(m))).toBe(true);
  });
});

describe("ClockInDto", () => {
  it("caps notes at 500 chars (payroll column)", async () => {
    const dto = plainToInstance(ClockInDto, { notes: "x".repeat(501) });
    expect((await errs(dto)).some((m) => /notes/.test(m))).toBe(true);
  });
});

describe("BulkAssignShiftDto", () => {
  it("validates each nested assignment", async () => {
    const dto = plainToInstance(BulkAssignShiftDto, {
      assignments: [
        { userId: "u1", shiftTemplateId: "s1", date: "not-a-date" },
      ],
    });
    expect((await errs(dto)).some((m) => /date/.test(m))).toBe(true);
  });

  it("accepts well-formed nested assignments", async () => {
    const dto = plainToInstance(BulkAssignShiftDto, {
      assignments: [
        { userId: "u1", shiftTemplateId: "s1", date: "2026-06-15" },
      ],
    });
    expect(await errs(dto)).toEqual([]);
  });
});

describe("AssignShiftDto", () => {
  it("rejects a non-ISO date", async () => {
    const dto = plainToInstance(AssignShiftDto, {
      userId: "u1",
      shiftTemplateId: "s1",
      date: "15/06/2026",
    });
    expect((await errs(dto)).some((m) => /date/.test(m))).toBe(true);
  });
});

describe("AttendanceQueryDto", () => {
  it("rejects an out-of-enum status", async () => {
    const dto = plainToInstance(AttendanceQueryDto, { status: "SLEEPING" });
    expect((await errs(dto)).some((m) => /status/.test(m))).toBe(true);
  });

  it("accepts a valid status + clamps limit", async () => {
    expect(
      await errs(
        plainToInstance(AttendanceQueryDto, {
          status: AttendanceStatus.CLOCKED_IN,
          limit: "50",
        }),
      ),
    ).toEqual([]);
    const over = plainToInstance(AttendanceQueryDto, { limit: "500" });
    expect((await errs(over)).some((m) => /limit/.test(m))).toBe(true);
  });

  it("coerces empty-string dates to undefined", async () => {
    const dto = plainToInstance(AttendanceQueryDto, { startDate: "" });
    expect(await errs(dto)).toEqual([]);
    expect(dto.startDate).toBeUndefined();
  });
});
