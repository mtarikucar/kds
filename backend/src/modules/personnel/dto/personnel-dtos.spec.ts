import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { ClockInDto } from "./clock-in.dto";
import { CreateShiftTemplateDto } from "./create-shift-template.dto";
import { AssignShiftDto, BulkAssignShiftDto } from "./assign-shift.dto";
import { AttendanceQueryDto } from "./attendance-query.dto";
import { PerformanceQueryDto } from "./performance-query.dto";
import { ScheduleQueryDto } from "./schedule-query.dto";
import { CreateSwapRequestDto } from "./create-swap-request.dto";
import { UpdateShiftTemplateDto } from "./update-shift-template.dto";
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

describe("PerformanceQueryDto", () => {
  it("accepts ISO dates + a userId and rejects a bad date", async () => {
    expect(
      await errs(
        plainToInstance(PerformanceQueryDto, {
          startDate: "2026-06-01",
          endDate: "2026-06-30",
          userId: "u1",
        }),
      ),
    ).toEqual([]);
    const bad = plainToInstance(PerformanceQueryDto, { startDate: "soon" });
    expect((await errs(bad)).some((m) => /startDate/.test(m))).toBe(true);
  });
});

describe("ScheduleQueryDto", () => {
  it("rejects a non-ISO weekStart", async () => {
    const dto = plainToInstance(ScheduleQueryDto, { weekStart: "monday" });
    expect((await errs(dto)).some((m) => /weekStart/.test(m))).toBe(true);
  });

  it("accepts an ISO weekStart", async () => {
    expect(
      await errs(plainToInstance(ScheduleQueryDto, { weekStart: "2026-06-15" })),
    ).toEqual([]);
  });
});

describe("CreateSwapRequestDto", () => {
  it("requires the three id strings", async () => {
    const dto = plainToInstance(CreateSwapRequestDto, {});
    const msgs = await errs(dto);
    expect(msgs.some((m) => /targetId/.test(m))).toBe(true);
    expect(msgs.some((m) => /requesterAssignmentId/.test(m))).toBe(true);
    expect(msgs.some((m) => /targetAssignmentId/.test(m))).toBe(true);
  });

  it("accepts a complete swap request", async () => {
    const dto = plainToInstance(CreateSwapRequestDto, {
      targetId: "u2",
      requesterAssignmentId: "a1",
      targetAssignmentId: "a2",
    });
    expect(await errs(dto)).toEqual([]);
  });
});

describe("UpdateShiftTemplateDto", () => {
  it("is a partial of the create DTO (empty patch ok, invalid time rejected)", async () => {
    expect(await errs(plainToInstance(UpdateShiftTemplateDto, {}))).toEqual([]);
    const bad = plainToInstance(UpdateShiftTemplateDto, { startTime: "99:99" });
    expect((await errs(bad)).some((m) => /startTime/.test(m))).toBe(true);
  });
});
