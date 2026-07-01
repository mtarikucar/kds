import { AttendanceService } from "./attendance.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * deep-review H6/M7 regression: the Attendance.date column is `@db.Date`,
 * which truncates the stored instant to its UTC calendar date. Stamping
 * the `getTenantMidnight` *instant* (Istanbul midnight = the previous
 * UTC day for a UTC+3 tenant) truncated the row to the PREVIOUS calendar
 * day for every positive-offset tenant — corrupting payroll day
 * boundaries AND breaking the clockIn->shiftAssignment join (schedule
 * stores the true calendar day), so isLate/lateMinutes/overtime were
 * silently always 0.
 *
 * The `date` column is now a tenant-local YYYY-MM-DD anchored at
 * UTC-midnight, so `@db.Date` truncation reflects the tenant's real day.
 */
describe("AttendanceService date-only handling (deep-review H6/M7)", () => {
  let prisma: MockPrismaClient;
  let kdsGateway: any;
  let svc: AttendanceService;

  // Compute the tenant-local YYYY-MM-DD the same way the service does.
  const tenantYmd = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

  // Pin the clock to a fixed mid-day instant (12:00 Istanbul = 09:00 UTC) so
  // the clockIn lateness test is deterministic. The "any clock-in after a 00:00
  // shift is late" assumption otherwise breaks in the ~21:00-21:59 UTC window,
  // where a UTC+3 tenant's local time is 00:00-00:59 — the clock-in lands ON
  // (or within a rounding-minute of) the shift start and is CORRECTLY not late,
  // so isLate/lateMinutes flip and the suite fails purely on the wall clock.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-24T09:00:00Z"));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitAttendanceUpdate: jest.fn() };
    svc = new AttendanceService(prisma as any, kdsGateway);
  });

  it("clockIn stamps date as the tenant-local calendar day at UTC-midnight", async () => {
    const TR = "Europe/Istanbul";
    prisma.tenant.findUnique.mockResolvedValue({ timezone: TR } as any);
    prisma.attendance.findFirst.mockResolvedValue(null);
    prisma.shiftAssignment.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      primaryBranchId: "branch-1",
    } as any);
    (prisma.attendance.create as any).mockResolvedValue({
      id: "a-1",
      branchId: "branch-1",
      user: {},
    });

    await svc.clockIn("tenant-1", "user-1");

    // The lookup date and the created date must both equal the tenant's
    // local calendar day anchored at UTC-midnight (so @db.Date keeps it).
    const expected = new Date(`${tenantYmd(TR)}T00:00:00.000Z`);
    const lookupArgs = (prisma.attendance.findFirst as any).mock.calls[0][0];
    expect((lookupArgs.where.date as Date).getTime()).toBe(expected.getTime());
    expect((lookupArgs.where.date as Date).toISOString()).toBe(
      `${tenantYmd(TR)}T00:00:00.000Z`,
    );

    const createArgs = (prisma.attendance.create as any).mock.calls[0][0];
    expect((createArgs.data.date as Date).getTime()).toBe(expected.getTime());

    // v3.0.0: gateway emit takes explicit branchId as 2nd arg.
    expect(kdsGateway.emitAttendanceUpdate).toHaveBeenCalledWith(
      "tenant-1",
      "branch-1",
      expect.objectContaining({ id: "a-1", branchId: "branch-1" }),
    );
  });

  it("clockIn matches the shiftAssignment join and records isLate/lateMinutes for a UTC+3 tenant", async () => {
    const TR = "Europe/Istanbul";
    prisma.tenant.findUnique.mockResolvedValue({ timezone: TR } as any);
    prisma.attendance.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      primaryBranchId: "branch-1",
    } as any);

    // Shift started 00:00 tenant-local with no grace, so any clock-in
    // later in the tenant's day is "late" — this exercises the tenant-tz
    // shiftStart computation (deep-review H6 secondary) deterministically
    // regardless of the wall-clock time the test runs at.
    prisma.shiftAssignment.findFirst.mockResolvedValue({
      id: "sa-1",
      branchId: "branch-1",
      shiftTemplate: {
        startTime: "00:00",
        endTime: "08:00",
        gracePeriodMinutes: 0,
      },
    } as any);

    let captured: any;
    (prisma.attendance.create as any).mockImplementation((args: any) => {
      captured = args.data;
      return Promise.resolve({ id: "a-1", branchId: "branch-1", user: {} });
    });

    await svc.clockIn("tenant-1", "user-1");

    // The shiftAssignment lookup uses the same tenant-local date as the
    // assignment writer, so the join is non-null and lateness is recorded.
    const saLookup = (prisma.shiftAssignment.findFirst as any).mock.calls[0][0];
    const expected = new Date(`${tenantYmd(TR)}T00:00:00.000Z`);
    expect((saLookup.where.date as Date).getTime()).toBe(expected.getTime());
    expect(captured.shiftAssignmentId).toBe("sa-1");
    expect(captured.isLate).toBe(true);
    expect(captured.lateMinutes).toBeGreaterThan(0);
  });

  it("falls back to UTC when tenant.timezone is null", async () => {
    prisma.tenant.findUnique.mockResolvedValue({ timezone: null } as any);
    prisma.attendance.findFirst.mockResolvedValue(null);
    prisma.shiftAssignment.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      primaryBranchId: "branch-1",
    } as any);
    (prisma.attendance.create as any).mockResolvedValue({
      id: "a-1",
      branchId: "branch-1",
      user: {},
    });

    await svc.clockIn("tenant-1", "user-1");

    const lookupArgs = (prisma.attendance.findFirst as any).mock.calls[0][0];
    const expected = new Date(`${tenantYmd("UTC")}T00:00:00.000Z`);
    expect((lookupArgs.where.date as Date).getTime()).toBe(expected.getTime());
  });
});

/**
 * Track-1 branch-scope hardening: the attendance READ paths must filter
 * by the active branch. A manager pinned to branch A must not read
 * branch B's attendance rows. Self-scoped reads (my-status) still pin
 * the branch so a user only sees their record within the active branch.
 */
describe("AttendanceService branch-scope reads (track-1)", () => {
  let prisma: MockPrismaClient;
  let kdsGateway: any;
  let svc: AttendanceService;
  const scope = {
    tenantId: "t-1",
    branchId: "b-1",
    userId: "u-1",
    role: "MANAGER",
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    kdsGateway = { emitAttendanceUpdate: jest.fn() };
    svc = new AttendanceService(prisma as any, kdsGateway);
    prisma.tenant.findUnique.mockResolvedValue({ timezone: "UTC" } as any);
  });

  it("getTodayAttendance filters by branchId + tenantId", async () => {
    (prisma.attendance.findMany as any).mockResolvedValue([]);

    await svc.getTodayAttendance(scope);

    const where = (prisma.attendance.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe("b-1");
    expect(where.tenantId).toBe("t-1");
  });

  it("getAttendanceHistory filters by branchId + tenantId", async () => {
    (prisma.attendance.findMany as any).mockResolvedValue([]);
    (prisma.attendance.count as any).mockResolvedValue(0);

    await svc.getAttendanceHistory(scope, {} as any);

    const where = (prisma.attendance.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe("b-1");
    expect(where.tenantId).toBe("t-1");
  });

  it("getAttendanceSummary filters by branchId + tenantId", async () => {
    (prisma.attendance.findMany as any).mockResolvedValue([]);

    await svc.getAttendanceSummary(scope, {} as any);

    const where = (prisma.attendance.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe("b-1");
    expect(where.tenantId).toBe("t-1");
  });

  it("getAttendanceSummaryCsv emits worked/overtime/late columns and NO wage/money column", async () => {
    (prisma.attendance.findMany as any).mockResolvedValue([
      {
        userId: "u-1",
        user: { id: "u-1", firstName: "Ada", lastName: "Lovelace", role: "WAITER" },
        totalWorkedMinutes: 480,
        totalBreakMinutes: 30,
        overtimeMinutes: 60,
        isLate: true,
        lateMinutes: 15,
      },
    ]);

    const csv = await svc.getAttendanceSummaryCsv(scope, {} as any);
    const lines = csv.split("\n");

    // Header is attendance/hours only — no wage/pay/salary/cost columns.
    expect(lines[0]).toBe(
      "Staff,Role,Total Days,Worked Minutes,Overtime Minutes,Break Minutes,Late Days,Late Minutes",
    );
    expect(csv.toLowerCase()).not.toMatch(/wage|salary|pay|cost|rate/);

    // Data row carries the real worked/overtime numbers.
    expect(lines[1]).toBe("Ada Lovelace,WAITER,1,480,60,30,1,15");
  });

  it("getMyStatus self-scopes by tenant+user+date WITHOUT pinning the active branch (deep-review M8)", async () => {
    (prisma.attendance.findFirst as any).mockResolvedValue(null);

    await svc.getMyStatus(scope);

    const where = (prisma.attendance.findFirst as any).mock.calls[0][0].where;
    // A roaming ADMIN/MANAGER whose active branch != their primary branch
    // must still see their own row (which lives under their primary
    // branch), so the self-status read drops the active-branch predicate.
    expect(where.branchId).toBeUndefined();
    expect(where.tenantId).toBe("t-1");
    expect(where.userId).toBe("u-1");
  });
});
