import { MenuAiQuotaService } from "./menu-ai-quota.service";
import { BusinessException } from "../../../common/exceptions/business.exception";

/**
 * Quota math for the AI menu studio. The ledger (ai_generation_usage) is the
 * source of truth; these specs pin the money-relevant behaviors:
 *  - the cap is enforced against SUM(units) of non-voided rows this month
 *  - a claim that would cross the cap throws 402 QUOTA_EXCEEDED (never partial)
 *  - limit 0 (BASIC / FREE) denies before any transaction
 *  - -1 is unlimited (BUSINESS-style), no lock taken
 *  - engine-limit wins; engine outage falls back to override → plan → 0 (deny)
 *  - refunds (voidUsage / voidByJob) are idempotent updateMany({voided:false})
 */
describe("MenuAiQuotaService", () => {
  const TENANT = "t1";
  let prisma: any;
  let entitlements: any;
  let svc: MenuAiQuotaService;

  const setUsed = (units: number | null) =>
    (prisma.aiGenerationUsage.aggregate as jest.Mock).mockResolvedValue({
      _sum: { units },
    });
  const setEngineLimits = (limits: Record<string, number> | null) =>
    (entitlements.getForTenant as jest.Mock).mockResolvedValue(
      limits ? { limits } : { limits: {} },
    );

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
      aiGenerationUsage: {
        aggregate: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: "usage1" }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    entitlements = { getForTenant: jest.fn() };
    svc = new MenuAiQuotaService(prisma, entitlements);
  });

  describe("claim", () => {
    it("grants when under the cap and writes a ledger row", async () => {
      setEngineLimits({ "limit.maxMonthlyAiPhotos": 50 });
      setUsed(49);
      await expect(svc.claim(TENANT, "PHOTO", 1)).resolves.toBe("usage1");
      expect(prisma.aiGenerationUsage.create).toHaveBeenCalledWith({
        data: { tenantId: TENANT, kind: "PHOTO", units: 1 },
        select: { id: true },
      });
      // The race guard: the check must run under the advisory xact lock.
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });

    it("denies crossing the cap — 4 variations with 2 left is refused whole", async () => {
      setEngineLimits({ "limit.maxMonthlyAiPhotos": 50 });
      setUsed(48);
      await expect(svc.claim(TENANT, "PHOTO", 4)).rejects.toThrow(
        BusinessException,
      );
      expect(prisma.aiGenerationUsage.create).not.toHaveBeenCalled();
    });

    it("denies at the cap with 402 + QUOTA_EXCEEDED details", async () => {
      setEngineLimits({ "limit.maxMonthlyAiVideos": 5 });
      setUsed(5);
      try {
        await svc.claim(TENANT, "VIDEO", 1);
        fail("should have thrown");
      } catch (e: any) {
        expect(e).toBeInstanceOf(BusinessException);
        expect(e.getStatus()).toBe(402);
        expect(e.errorCode).toBe("QUOTA_EXCEEDED");
        expect(e.details).toMatchObject({ kind: "VIDEO", used: 5, limit: 5 });
      }
    });

    it("limit 0 (plan without AI) denies before any transaction", async () => {
      setEngineLimits({ "limit.maxMonthlyAiPhotos": 0 });
      await expect(svc.claim(TENANT, "PHOTO", 1)).rejects.toThrow(
        BusinessException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("-1 is unlimited: claims without taking the lock", async () => {
      setEngineLimits({ "limit.maxMonthlyAiPhotos": -1 });
      await expect(svc.claim(TENANT, "PHOTO", 4)).resolves.toBe("usage1");
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.aiGenerationUsage.aggregate).not.toHaveBeenCalled();
    });

    it("voided (refunded) rows do not count against the cap", async () => {
      setEngineLimits({ "limit.maxMonthlyAiVideos": 5 });
      setUsed(4); // 1 refunded row excluded by the voided:false filter
      await expect(svc.claim(TENANT, "VIDEO", 1)).resolves.toBe("usage1");
      const where = (prisma.aiGenerationUsage.aggregate as jest.Mock).mock
        .calls[0][0].where;
      expect(where.voided).toBe(false);
      expect(where.createdAt.gte).toBeInstanceOf(Date);
      expect(where.createdAt.gte.getDate()).toBe(1); // calendar-month window
    });
  });

  describe("limit resolution fallback", () => {
    it("falls back to the tenant's plan column when the engine has no grant", async () => {
      setEngineLimits(null);
      prisma.tenant.findUnique.mockResolvedValue({
        limitOverrides: null,
        currentPlan: { maxMonthlyAiPhotos: 50 },
      });
      setUsed(0);
      await expect(svc.claim(TENANT, "PHOTO", 1)).resolves.toBe("usage1");
    });

    it("limitOverrides beat the plan column", async () => {
      setEngineLimits(null);
      prisma.tenant.findUnique.mockResolvedValue({
        limitOverrides: { maxMonthlyAiPhotos: 0 },
        currentPlan: { maxMonthlyAiPhotos: 50 },
      });
      await expect(svc.claim(TENANT, "PHOTO", 1)).rejects.toThrow(
        BusinessException,
      );
    });

    it("engine outage + no plan → 0 (deny, never free)", async () => {
      (entitlements.getForTenant as jest.Mock).mockRejectedValue(
        new Error("redis down"),
      );
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(svc.claim(TENANT, "PHOTO", 1)).rejects.toThrow(
        BusinessException,
      );
    });
  });

  describe("refunds", () => {
    it("voidUsage flips voided once (idempotent guard in the where)", async () => {
      await svc.voidUsage("usage1");
      expect(prisma.aiGenerationUsage.updateMany).toHaveBeenCalledWith({
        where: { id: "usage1", voided: false },
        data: { voided: true },
      });
    });

    it("voidByJob refunds by job id", async () => {
      await svc.voidByJob("job1");
      expect(prisma.aiGenerationUsage.updateMany).toHaveBeenCalledWith({
        where: { jobId: "job1", voided: false },
        data: { voided: true },
      });
    });
  });

  describe("getUsage", () => {
    it("reports used/limit/remaining", async () => {
      setEngineLimits({ "limit.maxMonthlyAiPhotos": 50 });
      setUsed(12);
      await expect(svc.getUsage(TENANT, "PHOTO")).resolves.toEqual({
        used: 12,
        limit: 50,
        remaining: 38,
      });
    });

    it("unlimited reports remaining -1", async () => {
      setEngineLimits({ "limit.maxMonthlyAiVideos": -1 });
      setUsed(7);
      await expect(svc.getUsage(TENANT, "VIDEO")).resolves.toEqual({
        used: 7,
        limit: -1,
        remaining: -1,
      });
    });
  });
});
