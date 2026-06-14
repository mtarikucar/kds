import { SuperAdminDashboardService } from "./superadmin-dashboard.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

/**
 * The dashboard service is pure aggregation + arithmetic over Prisma counts.
 * The branches worth pinning are the MONEY math (MRR = monthly + yearly/12,
 * rounded to cents), the growth-percent helper (incl. the divide-by-zero
 * guard), revenue grouping by ISO date, and the period→startDate switch.
 * Decimal amounts arrive as Prisma.Decimal-like objects, so every sum goes
 * through Number(); a regression to plain `+` would NaN the totals.
 */
describe("SuperAdminDashboardService", () => {
  let prisma: MockPrismaClient;
  let svc: SuperAdminDashboardService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new SuperAdminDashboardService(prisma as any);
  });

  describe("getStats — MRR", () => {
    it("computes MRR as monthly + yearly/12, rounded to cents", async () => {
      // 8 count() calls in the Promise.all, in declared order.
      prisma.tenant.count
        .mockResolvedValueOnce(10 as any) // total
        .mockResolvedValueOnce(7 as any) // active
        .mockResolvedValueOnce(2 as any); // suspended
      prisma.user.count.mockResolvedValueOnce(40 as any);
      prisma.order.count.mockResolvedValueOnce(500 as any);
      prisma.subscription.count
        .mockResolvedValueOnce(9 as any) // total subs
        .mockResolvedValueOnce(6 as any) // active
        .mockResolvedValueOnce(1 as any); // trial

      // Monthly subs: 100 + 50 = 150. Yearly subs: 1200 → /12 = 100.
      prisma.subscription.findMany
        .mockResolvedValueOnce([
          { amount: 100 },
          { amount: 50 },
        ] as any) // MONTHLY
        .mockResolvedValueOnce([{ amount: 1200 }] as any); // YEARLY

      const res = await svc.getStats();

      expect(res.revenue.mrr).toBe(250); // 150 + (1200/12=100)
      expect(res.tenants).toEqual({ total: 10, active: 7, suspended: 2 });
      expect(res.subscriptions).toEqual({ total: 9, active: 6, trial: 1 });
    });

    it("rounds fractional MRR to two decimals", async () => {
      prisma.tenant.count.mockResolvedValue(0 as any);
      prisma.user.count.mockResolvedValue(0 as any);
      prisma.order.count.mockResolvedValue(0 as any);
      prisma.subscription.count.mockResolvedValue(0 as any);
      // yearly 100/12 = 8.3333... → rounds to 8.33
      prisma.subscription.findMany
        .mockResolvedValueOnce([] as any)
        .mockResolvedValueOnce([{ amount: 100 }] as any);

      const res = await svc.getStats();
      expect(res.revenue.mrr).toBe(8.33);
    });
  });

  describe("getGrowthMetrics", () => {
    it("returns 100% growth when the previous period was zero but the current is positive", async () => {
      prisma.tenant.count
        .mockResolvedValueOnce(5 as any) // tenantsThisMonth
        .mockResolvedValueOnce(0 as any); // tenantsLastMonth
      prisma.user.count
        .mockResolvedValueOnce(0 as any) // usersThisMonth
        .mockResolvedValueOnce(0 as any); // usersLastMonth (0 & 0 → 0)
      prisma.order.count
        .mockResolvedValueOnce(20 as any) // ordersThisMonth
        .mockResolvedValueOnce(10 as any); // ordersLastMonth → +100%

      const res = await svc.getGrowthMetrics();
      expect(res.tenants.growth).toBe(100); // prev 0, current 5
      expect(res.users.growth).toBe(0); // prev 0, current 0
      expect(res.orders.growth).toBe(100); // (20-10)/10
    });

    it("computes a negative growth percentage on decline", async () => {
      prisma.tenant.count
        .mockResolvedValueOnce(8 as any)
        .mockResolvedValueOnce(10 as any); // -20%
      prisma.user.count
        .mockResolvedValueOnce(5 as any)
        .mockResolvedValueOnce(5 as any);
      prisma.order.count
        .mockResolvedValueOnce(50 as any)
        .mockResolvedValueOnce(100 as any); // -50%

      const res = await svc.getGrowthMetrics();
      expect(res.tenants.growth).toBe(-20);
      expect(res.users.growth).toBe(0);
      expect(res.orders.growth).toBe(-50);
    });
  });

  describe("getRevenueAnalytics", () => {
    it("groups payment amounts by ISO date and totals them", async () => {
      prisma.subscriptionPayment.findMany.mockResolvedValue([
        { amount: 100, paidAt: new Date("2026-01-01T10:00:00Z") },
        { amount: 50, paidAt: new Date("2026-01-01T20:00:00Z") },
        { amount: 25, paidAt: new Date("2026-01-02T05:00:00Z") },
      ] as any);

      const res = await svc.getRevenueAnalytics("month");
      expect(res.period).toBe("month");
      expect(res.total).toBe(175);
      expect(res.data).toEqual([
        { date: "2026-01-01", amount: 150 },
        { date: "2026-01-02", amount: 25 },
      ]);
    });

    it("selects a ~7-day window for period=week", async () => {
      prisma.subscriptionPayment.findMany.mockResolvedValue([] as any);
      await svc.getRevenueAnalytics("week");
      const arg = prisma.subscriptionPayment.findMany.mock.calls[0][0] as any;
      const gte: Date = arg.where.paidAt.gte;
      const deltaDays = (Date.now() - gte.getTime()) / (24 * 3600 * 1000);
      expect(Math.round(deltaDays)).toBe(7);
    });
  });

  describe("getPlanDistribution", () => {
    it("joins active-subscription group counts to plan display names, falling back to Unknown", async () => {
      prisma.subscription.groupBy.mockResolvedValue([
        { planId: "plan-a", _count: 3 },
        { planId: "plan-ghost", _count: 1 },
      ] as any);
      prisma.subscriptionPlan.findMany.mockResolvedValue([
        { id: "plan-a", name: "pro", displayName: "Pro" },
      ] as any);

      const res = await svc.getPlanDistribution();
      expect(res).toEqual([
        {
          planId: "plan-a",
          planName: "pro",
          planDisplayName: "Pro",
          count: 3,
        },
        {
          planId: "plan-ghost",
          planName: "Unknown",
          planDisplayName: "Unknown",
          count: 1,
        },
      ]);
    });
  });
});
