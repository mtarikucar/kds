import { SuperAdminDashboardService } from "./superadmin-dashboard.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * The dashboard is pure aggregation over the à-la-carte rail. What has to hold:
 * ARR counts only what actually renews (annual, active, not comped), the licence
 * census does not double-count a tenant that holds both a live and a lapsed
 * licence row, revenue groups invoices by ISO date in kuruş, and the product
 * distribution survives a catalog row that has since been deleted.
 *
 * These replace the MRR/plan-distribution tests one for one. The old ones
 * measured the subscription rail, which nothing writes to any more — they would
 * have kept passing against permanently-zero data.
 */
describe("SuperAdminDashboardService", () => {
  let prisma: MockPrismaClient;
  let svc: SuperAdminDashboardService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SuperAdminDashboardService(prisma as any);
    prisma.tenant.count
      .mockResolvedValueOnce(10 as any) // total
      .mockResolvedValueOnce(9 as any) // active
      .mockResolvedValueOnce(1 as any); // suspended
    prisma.user.count.mockResolvedValue(40 as any);
    prisma.order.count.mockResolvedValue(500 as any);
  });

  const row = (over: Record<string, unknown> = {}) => ({
    tenantId: "t-1",
    quantity: 1,
    status: "active",
    origin: "purchase",
    addOn: { kind: "module", billing: "annual", priceCents: 99_000 },
    ...over,
  });

  describe("getStats", () => {
    it("sums ARR from active annual lines, multiplied by quantity", async () => {
      prisma.tenantAddOn.findMany.mockResolvedValue([
        row(), // 990.00
        row({ quantity: 3, addOn: { kind: "capacity", billing: "annual", priceCents: 399_000 } }),
      ] as any);

      const res = await svc.getStats();
      expect(res.revenue.arrCents).toBe(99_000 + 3 * 399_000);
    });

    it("excludes comps from ARR but counts them separately", async () => {
      // A comp grants capability and bills nothing. Folding it into ARR would
      // inflate the single number used to judge whether the business works.
      prisma.tenantAddOn.findMany.mockResolvedValue([
        row(),
        row({ origin: "comp", tenantId: "t-2" }),
      ] as any);

      const res = await svc.getStats();
      expect(res.revenue.arrCents).toBe(99_000);
      expect(res.licensing.compedProducts).toBe(1);
    });

    it("leaves one-time lines out of ARR", async () => {
      prisma.tenantAddOn.findMany.mockResolvedValue([
        row({ addOn: { kind: "service", billing: "oneTime", priceCents: 750_000 } }),
      ] as any);

      expect((await svc.getStats()).revenue.arrCents).toBe(0);
    });

    it("counts a licensed tenant once even when a lapsed row is still around", async () => {
      // A renewal landing while the old row is still past_due would otherwise
      // report the same tenant as both licensed AND in grace.
      prisma.tenantAddOn.findMany.mockResolvedValue([
        row({ addOn: { kind: "license", billing: "annual", priceCents: 299_000 } }),
        row({
          status: "past_due",
          addOn: { kind: "license", billing: "annual", priceCents: 299_000 },
        }),
      ] as any);

      const res = await svc.getStats();
      expect(res.licensing.licensed).toBe(1);
      expect(res.licensing.inGrace).toBe(0);
      expect(res.licensing.unlicensed).toBe(9);
    });

    it("never reports negative unlicensed tenants", async () => {
      prisma.tenant.count.mockReset();
      prisma.tenant.count
        .mockResolvedValueOnce(1 as any)
        .mockResolvedValueOnce(1 as any)
        .mockResolvedValueOnce(0 as any);
      prisma.tenantAddOn.findMany.mockResolvedValue([
        row({ addOn: { kind: "license", billing: "annual", priceCents: 299_000 } }),
        row({
          tenantId: "t-ghost",
          status: "past_due",
          addOn: { kind: "license", billing: "annual", priceCents: 299_000 },
        }),
      ] as any);

      expect((await svc.getStats()).licensing.unlicensed).toBe(0);
    });
  });

  describe("getGrowthMetrics", () => {
    it("returns 100% growth when the previous period was zero but the current is positive", async () => {
      prisma.tenant.count.mockReset();
      prisma.tenant.count
        .mockResolvedValueOnce(5 as any)
        .mockResolvedValueOnce(0 as any);
      prisma.user.count
        .mockResolvedValueOnce(0 as any)
        .mockResolvedValueOnce(0 as any);
      prisma.order.count
        .mockResolvedValueOnce(0 as any)
        .mockResolvedValueOnce(0 as any);

      const res = await svc.getGrowthMetrics();
      expect(res.tenants.growth).toBe(100);
      expect(res.users.growth).toBe(0);
    });

    it("computes a negative growth percentage on decline", async () => {
      prisma.tenant.count.mockReset();
      prisma.tenant.count
        .mockResolvedValueOnce(0 as any)
        .mockResolvedValueOnce(0 as any);
      prisma.user.count
        .mockResolvedValueOnce(0 as any)
        .mockResolvedValueOnce(0 as any);
      prisma.order.count
        .mockResolvedValueOnce(5 as any)
        .mockResolvedValueOnce(10 as any);

      expect((await svc.getGrowthMetrics()).orders.growth).toBe(-50);
    });
  });

  describe("getRevenueAnalytics", () => {
    it("groups invoice totals by ISO date, in kurus, and splits by kind", async () => {
      prisma.tenantInvoice.findMany.mockResolvedValue([
        { totalCents: 299_000, issuedAt: new Date("2026-08-01T10:00:00Z"), kind: "purchase" },
        { totalCents: 99_000, issuedAt: new Date("2026-08-01T20:00:00Z"), kind: "purchase" },
        { totalCents: 69_000, issuedAt: new Date("2026-08-02T05:00:00Z"), kind: "credit" },
      ] as any);

      const res = await svc.getRevenueAnalytics("month");
      expect(res.totalCents).toBe(467_000);
      expect(res.data).toEqual([
        { date: "2026-08-01", amountCents: 398_000 },
        { date: "2026-08-02", amountCents: 69_000 },
      ]);
      expect(res.byKind).toEqual([
        { kind: "purchase", amountCents: 398_000 },
        { kind: "credit", amountCents: 69_000 },
      ]);
    });

    it("ignores VOID invoices — a voided charge is not revenue", async () => {
      prisma.tenantInvoice.findMany.mockResolvedValue([] as any);
      await svc.getRevenueAnalytics("month");
      const arg = prisma.tenantInvoice.findMany.mock.calls[0][0] as any;
      expect(arg.where.status.in).toEqual(["PAID", "OPEN"]);
    });

    it("selects a ~7-day window for period=week", async () => {
      prisma.tenantInvoice.findMany.mockResolvedValue([] as any);
      await svc.getRevenueAnalytics("week");
      const arg = prisma.tenantInvoice.findMany.mock.calls[0][0] as any;
      const gte: Date = arg.where.issuedAt.gte;
      const deltaDays = (Date.now() - gte.getTime()) / (24 * 3600 * 1000);
      expect(Math.round(deltaDays)).toBe(7);
    });
  });

  describe("getProductDistribution", () => {
    it("ranks products by tenant count and values them at list price", async () => {
      prisma.tenantAddOn.groupBy.mockResolvedValue([
        { addOnId: "a-1", _count: 2, _sum: { quantity: 2 } },
        { addOnId: "a-2", _count: 5, _sum: { quantity: 7 } },
      ] as any);
      prisma.marketplaceAddOn.findMany.mockResolvedValue([
        { id: "a-1", code: "module_personnel", name: "Personel", kind: "module", priceCents: 99_000 },
        { id: "a-2", code: "extra_branch", name: "Ek Şube", kind: "capacity", priceCents: 399_000 },
      ] as any);

      const res = await svc.getProductDistribution();
      expect(res[0].code).toBe("extra_branch");
      expect(res[0].units).toBe(7);
      expect(res[0].annualValueCents).toBe(7 * 399_000);
    });

    it("survives an ownership row whose catalog product was deleted", async () => {
      prisma.tenantAddOn.groupBy.mockResolvedValue([
        { addOnId: "gone", _count: 1, _sum: { quantity: 1 } },
      ] as any);
      prisma.marketplaceAddOn.findMany.mockResolvedValue([] as any);

      const res = await svc.getProductDistribution();
      expect(res[0]).toMatchObject({ code: "unknown", annualValueCents: 0 });
    });

    it("skips the catalog read entirely when nothing is owned", async () => {
      prisma.tenantAddOn.groupBy.mockResolvedValue([] as any);
      expect(await svc.getProductDistribution()).toEqual([]);
      expect(prisma.marketplaceAddOn.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getAlerts", () => {
    it("counts licences inside the renewal window, not trials", async () => {
      prisma.tenantAddOn.count
        .mockResolvedValueOnce(3 as any) // expiring licences
        .mockResolvedValueOnce(2 as any); // past_due
      prisma.tenant.count.mockReset();
      prisma.tenant.count.mockResolvedValue(1 as any);
      prisma.checkoutIntent.count.mockResolvedValue(4 as any);

      const res = await svc.getAlerts();
      expect(res).toEqual({
        expiringLicences: 3,
        lapsedProducts: 2,
        suspendedTenants: 1,
        failedCheckouts: 4,
      });
    });
  });
});
