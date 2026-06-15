import { ZReportSchedulerService } from "./z-report-scheduler.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";
import { getTenantMidnight } from "../../../common/helpers/timezone.helper";

/**
 * Behavioural tests for the auto Z-Report scheduler.
 *
 * The DB and the ZReportsService are mocked, but the scheduler's REAL
 * selection / guarding logic runs: which tenants are at closing time, the
 * tenant-timezone dedup, the postgres advisory-lock gate, the per-branch
 * fan-out, and (critically) per-tenant + per-branch error ISOLATION — one
 * tenant's failure must not abort the rest of the run, because the fiscal
 * close window is only 15 minutes wide and a thrown loop would silently
 * skip every tenant after the first failure until the next cron tick.
 *
 * Clock is pinned. Closing-time matching keys off the tenant timezone; we
 * use "UTC" tenants and a fixed system time so the 0-14min window is
 * deterministic regardless of the machine the suite runs on.
 */
describe("ZReportSchedulerService", () => {
  let prisma: MockPrismaClient;
  let zReports: { generateAndSendReport: jest.Mock };
  let svc: ZReportSchedulerService;

  // 2026-06-10 14:05:00 UTC. A tenant whose closingTime is "14:00" is then
  // 5 minutes into its closing window (0 <= 5 < 15) and MATCHES.
  const NOW = new Date("2026-06-10T14:05:00.000Z");

  /** Make the advisory lock succeed (default for most tests). */
  const grantLock = () => {
    (prisma.$queryRawUnsafe as any).mockResolvedValue([{ locked: true }]);
  };

  /** A fully-eligible UTC tenant sitting inside its closing window. */
  const eligibleTenant = (overrides: Record<string, any> = {}) => ({
    id: "t-1",
    name: "Cafe One",
    closingTime: "14:00",
    timezone: "UTC",
    reportEmails: ["owner@cafe.test"],
    ...overrides,
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    prisma = mockPrismaClient();
    zReports = { generateAndSendReport: jest.fn() };
    svc = new ZReportSchedulerService(prisma as any, zReports as any);

    // Sensible defaults; individual tests override as needed.
    grantLock();
    (prisma.$queryRawUnsafe as any).mockImplementation((sql: string) => {
      // try_advisory_lock returns a row; unlock returns whatever.
      if (sql.includes("pg_try_advisory_lock")) return [{ locked: true }];
      return [];
    });
    prisma.tenant.findMany.mockResolvedValue([]);
    prisma.zReport.findFirst.mockResolvedValue(null);
    prisma.user.findFirst.mockResolvedValue({
      id: "admin-1",
      primaryBranchId: "b-primary",
    } as any);
    prisma.branch.findMany.mockResolvedValue([]);
    zReports.generateAndSendReport.mockResolvedValue({
      reportId: "zr-1",
      emailSent: true,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Tenant selection filter
  // ---------------------------------------------------------------------------
  describe("getTenantsAtClosingTime (via handleZReportEmails)", () => {
    it("queries only ACTIVE tenants that have email enabled with recipients", async () => {
      prisma.tenant.findMany.mockResolvedValue([]);

      await svc.handleZReportEmails();

      const where = (prisma.tenant.findMany as any).mock.calls[0][0].where;
      expect(where.reportEmailEnabled).toBe(true);
      expect(where.status).toBe("ACTIVE");
      expect(where.reportEmails).toEqual({ isEmpty: false });
    });

    it("acts on a tenant whose closing time is inside the 0-14min window", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).toHaveBeenCalledWith(
        "t-1",
        "b-1",
        "admin-1",
      );
    });

    it("SKIPS a tenant whose closing time is more than 14 minutes ago", async () => {
      // closing 13:40, now 14:05 -> 25 minutes since closing -> outside window.
      prisma.tenant.findMany.mockResolvedValue([
        eligibleTenant({ closingTime: "13:40" }),
      ] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("SKIPS a tenant whose closing time has not arrived yet", async () => {
      // closing 14:10, now 14:05 -> minutesSinceClosing = -5 -> not yet.
      prisma.tenant.findMany.mockResolvedValue([
        eligibleTenant({ closingTime: "14:10" }),
      ] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("SKIPS a tenant with a null closing time", async () => {
      prisma.tenant.findMany.mockResolvedValue([
        eligibleTenant({ closingTime: null }),
      ] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("respects the tenant's timezone when matching the window", async () => {
      // New York is UTC-4 in June (EDT). 14:05 UTC == 10:05 local. A tenant
      // whose closing time is the LOCAL "10:00" is inside the window even
      // though 10:00 UTC is hours away. This proves the match is tz-aware,
      // not server-local.
      prisma.tenant.findMany.mockResolvedValue([
        eligibleTenant({ timezone: "America/New_York", closingTime: "10:00" }),
      ] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).toHaveBeenCalledWith(
        "t-1",
        "b-1",
        "admin-1",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Idempotency / no double-run
  // ---------------------------------------------------------------------------
  describe("idempotency / dedup (now PER BRANCH)", () => {
    it("SKIPS a branch that already has a FINALIZED report for today (tenant-tz midnight)", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);
      prisma.zReport.findFirst.mockResolvedValue({ id: "zr-existing" } as any);

      await svc.handleZReportEmails();

      // dedup read keyed on tenant id + BRANCH id + tenant-tz midnight +
      // isFinalized — the leak fix adds branchId to the predicate.
      const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe("t-1");
      expect(where.branchId).toBe("b-1");
      expect(where.isFinalized).toBe(true);
      expect(where.reportDate.getTime()).toBe(
        getTenantMidnight(NOW, "UTC").getTime(),
      );
      // and because this branch's finalized report exists, no generation.
      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("PROCEEDS when only a NON-finalized report exists (dedup keys on isFinalized)", async () => {
      // The dedup query itself filters isFinalized:true, so a draft/un-
      // finalized row returns null here and the branch is still processed.
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);
      prisma.zReport.findFirst.mockResolvedValue(null); // finalized:true -> none

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).toHaveBeenCalledTimes(1);
    });

    it("LEAK FIX: one branch already closed does NOT skip the tenant's other branches", async () => {
      // The bug: a tenant-level done-check {tenantId, reportDate,
      // isFinalized} (no branchId) dropped the WHOLE tenant the instant
      // ANY one branch finalized. Now the check is per-branch, so b-1
      // (done) is skipped while b-2 and b-3 still generate.
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([
        { id: "b-1" },
        { id: "b-2" },
        { id: "b-3" },
      ] as any);
      prisma.zReport.findFirst.mockImplementation(async ({ where }: any) =>
        where.branchId === "b-1" ? ({ id: "zr-b1-done" } as any) : null,
      );

      await svc.handleZReportEmails();

      const branchArgs = zReports.generateAndSendReport.mock.calls.map(
        (c) => c[1],
      );
      // b-1 is deduped; b-2 and b-3 still close.
      expect(branchArgs).toEqual(["b-2", "b-3"]);
    });

    it("the per-branch dedup is also tenant-scoped (no cross-tenant collision)", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);
      prisma.zReport.findFirst.mockResolvedValue(null);

      await svc.handleZReportEmails();

      const where = (prisma.zReport.findFirst as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe("t-1");
      expect(where.branchId).toBe("b-1");
    });
  });

  // ---------------------------------------------------------------------------
  // Advisory-lock / reentrancy guarding
  // ---------------------------------------------------------------------------
  describe("concurrency guards", () => {
    it("does NO tenant work when another replica holds the advisory lock", async () => {
      (prisma.$queryRawUnsafe as any).mockImplementation((sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) return [{ locked: false }];
        return [];
      });

      await svc.handleZReportEmails();

      expect(prisma.tenant.findMany).not.toHaveBeenCalled();
      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("releases the advisory lock after a successful run", async () => {
      prisma.tenant.findMany.mockResolvedValue([]);

      await svc.handleZReportEmails();

      const calls = (prisma.$queryRawUnsafe as any).mock.calls.map(
        (c: any[]) => c[0] as string,
      );
      expect(calls.some((s) => s.includes("pg_try_advisory_lock"))).toBe(true);
      expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    });

    it("releases the advisory lock even when tenant processing throws", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      // Make branch resolution explode AFTER the lock is held.
      (prisma.branch.findMany as any).mockRejectedValue(new Error("db down"));

      await svc.handleZReportEmails();

      const calls = (prisma.$queryRawUnsafe as any).mock.calls.map(
        (c: any[]) => c[0] as string,
      );
      expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    });

    it("does NOT acquire/unlock the lock again on a re-entrant call (isRunning guard)", async () => {
      // First call hangs inside tenant.findMany; second call should bail
      // immediately via the isRunning flag without touching the lock.
      let release!: () => void;
      const gate = new Promise<any[]>((resolve) => {
        release = () => resolve([]);
      });
      prisma.tenant.findMany.mockReturnValue(gate as any);

      const first = svc.handleZReportEmails();
      // Second, re-entrant invocation while the first is still in flight.
      await svc.handleZReportEmails();

      // Re-entrant call must not have queried the lock at all.
      expect((prisma.$queryRawUnsafe as any).mock.calls.length).toBe(1);

      release();
      await first;
    });
  });

  // ---------------------------------------------------------------------------
  // Per-branch fan-out + fallbacks
  // ---------------------------------------------------------------------------
  describe("processEndOfDayReport branch fan-out", () => {
    it("generates one report per ACTIVE branch", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([
        { id: "b-1" },
        { id: "b-2" },
        { id: "b-3" },
      ] as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).toHaveBeenCalledTimes(3);
      const branchArgs = zReports.generateAndSendReport.mock.calls.map(
        (c) => c[1],
      );
      expect(branchArgs).toEqual(["b-1", "b-2", "b-3"]);
      // active-branch lookup is tenant scoped + status active.
      const branchWhere = (prisma.branch.findMany as any).mock.calls[0][0].where;
      expect(branchWhere.tenantId).toBe("t-1");
      expect(branchWhere.status).toBe("active");
    });

    it("falls back to the admin's primary branch when no active branches exist", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([] as any); // none active
      prisma.user.findFirst.mockResolvedValue({
        id: "admin-1",
        primaryBranchId: "b-primary",
      } as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).toHaveBeenCalledTimes(1);
      expect(zReports.generateAndSendReport).toHaveBeenCalledWith(
        "t-1",
        "b-primary",
        "admin-1",
      );
    });

    it("SKIPS the tenant when there is no ADMIN user", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.user.findFirst.mockResolvedValue(null);

      await svc.handleZReportEmails();

      // never even resolves branches.
      expect(prisma.branch.findMany).not.toHaveBeenCalled();
      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("SKIPS the tenant when no branches resolve (no active + no primary)", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([] as any);
      prisma.user.findFirst.mockResolvedValue({
        id: "admin-1",
        primaryBranchId: null,
      } as any);

      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("looks up the ADMIN user scoped to the tenant", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);

      await svc.handleZReportEmails();

      const where = (prisma.user.findFirst as any).mock.calls[0][0].where;
      expect(where.tenantId).toBe("t-1");
      expect(where.role).toBe("ADMIN");
    });
  });

  // ---------------------------------------------------------------------------
  // Error isolation — the load-bearing reliability property
  // ---------------------------------------------------------------------------
  describe("error isolation", () => {
    it("one tenant's failure does NOT abort processing of later tenants", async () => {
      const t1 = eligibleTenant({ id: "t-1", name: "Boom" });
      const t2 = eligibleTenant({ id: "t-2", name: "Fine" });
      prisma.tenant.findMany.mockResolvedValue([t1, t2] as any);
      // both tenants resolve to one branch each.
      (prisma.branch.findMany as any).mockImplementation(
        async ({ where }: any) =>
          where.tenantId === "t-1" ? [{ id: "b-t1" }] : [{ id: "b-t2" }],
      );
      // t-1's branch generation throws; t-2's must still run.
      zReports.generateAndSendReport.mockImplementation(
        async (tenantId: string) => {
          if (tenantId === "t-1") throw new Error("fiscal device offline");
          return { reportId: "zr-2", emailSent: true };
        },
      );

      await svc.handleZReportEmails();

      const tenantArgs = zReports.generateAndSendReport.mock.calls.map(
        (c) => c[0],
      );
      expect(tenantArgs).toEqual(["t-1", "t-2"]);
    });

    it("one BRANCH's failure does NOT abort the tenant's other branches", async () => {
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([
        { id: "b-1" },
        { id: "b-2" },
      ] as any);
      zReports.generateAndSendReport.mockImplementation(
        async (_tenantId: string, branchId: string) => {
          if (branchId === "b-1") throw new Error("printer jam");
          return { reportId: "zr-b2", emailSent: true };
        },
      );

      await svc.handleZReportEmails();

      const branchArgs = zReports.generateAndSendReport.mock.calls.map(
        (c) => c[1],
      );
      expect(branchArgs).toEqual(["b-1", "b-2"]);
    });

    it("a thrown error inside the run is swallowed (cron must never reject)", async () => {
      prisma.tenant.findMany.mockRejectedValue(new Error("catastrophe"));

      await expect(svc.handleZReportEmails()).resolves.toBeUndefined();
    });

    it("clears the isRunning flag after a failure so the next tick can run", async () => {
      prisma.tenant.findMany.mockRejectedValueOnce(new Error("transient"));

      await svc.handleZReportEmails(); // fails internally, swallowed

      // Next tick: healthy run should proceed normally.
      prisma.tenant.findMany.mockResolvedValue([eligibleTenant()] as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-1" }] as any);
      await svc.handleZReportEmails();

      expect(zReports.generateAndSendReport).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Manual trigger
  // ---------------------------------------------------------------------------
  describe("triggerReportForTenant", () => {
    it("returns not-found without processing when the tenant does not exist", async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);

      const res = await svc.triggerReportForTenant("ghost");

      expect(res).toEqual({ success: false, message: "Tenant not found" });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(zReports.generateAndSendReport).not.toHaveBeenCalled();
    });

    it("processes the tenant's branches and reports success", async () => {
      prisma.tenant.findUnique.mockResolvedValue({
        id: "t-9",
        name: "Manual Co",
      } as any);
      prisma.user.findFirst.mockResolvedValue({
        id: "admin-9",
        primaryBranchId: "b-9",
      } as any);
      prisma.branch.findMany.mockResolvedValue([{ id: "b-9" }] as any);

      const res = await svc.triggerReportForTenant("t-9");

      expect(res.success).toBe(true);
      expect(zReports.generateAndSendReport).toHaveBeenCalledWith(
        "t-9",
        "b-9",
        "admin-9",
      );
    });
  });
});
