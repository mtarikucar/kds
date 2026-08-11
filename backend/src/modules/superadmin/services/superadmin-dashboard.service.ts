import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * Operator dashboard for the à-la-carte world.
 *
 * Every number here used to be read off the subscription rail — subscription
 * counts, MRR from Subscription.amount, a revenue chart over
 * SubscriptionPayment, plan distribution, trials ending. That rail is retired:
 * nothing writes to it any more, so every one of those figures would sit at
 * zero forever while looking like a working dashboard. They are replaced,
 * one for one, with the equivalent question in the new model:
 *
 *   active subscriptions  →  tenants holding a live licence
 *   MRR                   →  ARR: what the owned annual products renew for
 *   payment chart         →  TenantInvoice totals by day
 *   plan distribution     →  how many tenants own each product
 *   trials ending         →  licences and products inside the renewal window
 *
 * Comped rows are excluded from money and counted separately: a comp grants
 * capability but bills nothing, and folding it into ARR would inflate the one
 * number an operator uses to decide whether the business is working.
 */
@Injectable()
export class SuperAdminDashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats() {
    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalUsers,
      totalOrders,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: "ACTIVE" } }),
      this.prisma.tenant.count({ where: { status: "SUSPENDED" } }),
      this.prisma.user.count(),
      this.prisma.order.count({ where: { status: "PAID" } }),
    ]);

    // Live ownership, with the catalog price attached. One read serves both
    // the licence census and ARR, and it is small — a row per product per
    // tenant, not per event.
    const owned = await this.prisma.tenantAddOn.findMany({
      where: { status: { in: ["active", "past_due"] } },
      select: {
        tenantId: true,
        quantity: true,
        status: true,
        origin: true,
        addOn: {
          select: { kind: true, billing: true, priceCents: true },
        },
      },
    });

    const licensedTenants = new Set<string>();
    const graceTenants = new Set<string>();
    let arrCents = 0;
    let compedRows = 0;

    for (const row of owned) {
      if (row.addOn.kind === "license") {
        (row.status === "past_due" ? graceTenants : licensedTenants).add(
          row.tenantId,
        );
      }
      if (row.origin === "comp") {
        compedRows += 1;
        continue; // comps bill nothing — never in ARR
      }
      // Only annual lines recur. One-time rows (services) are revenue when
      // they happen, and they show up in the invoice chart instead.
      if (row.addOn.billing === "annual" && row.status === "active") {
        arrCents += row.addOn.priceCents * row.quantity;
      }
    }

    // A tenant in grace is not licensed; if a row exists in both sets the
    // active one wins (a renewal landed while an older row still lapses).
    for (const id of licensedTenants) graceTenants.delete(id);

    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        suspended: suspendedTenants,
      },
      users: { total: totalUsers },
      orders: { total: totalOrders },
      licensing: {
        licensed: licensedTenants.size,
        inGrace: graceTenants.size,
        // Not "unlicensed customers" — the free core means most tenants are
        // expected to be here. It is the top of the funnel, not a failure.
        unlicensed: Math.max(
          0,
          totalTenants - licensedTenants.size - graceTenants.size,
        ),
        compedProducts: compedRows,
      },
      revenue: {
        /** What the currently-owned annual products bill at next renewal. */
        arrCents,
      },
    };
  }

  async getRevenueAnalytics(period: "week" | "month" | "year" = "month") {
    const now = new Date();
    const days = period === "week" ? 7 : period === "year" ? 365 : 30;
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Real money, in kuruş, from the à-la-carte invoice — the only record of
    // what a tenant was actually charged. VOID rows are excluded; DRAFT ones
    // have not been charged yet.
    const invoices = await this.prisma.tenantInvoice.findMany({
      where: {
        status: { in: ["PAID", "OPEN"] },
        issuedAt: { gte: startDate },
      },
      select: { totalCents: true, issuedAt: true, kind: true },
      orderBy: { issuedAt: "asc" },
    });

    const byDate = new Map<string, number>();
    const byKind = new Map<string, number>();
    for (const inv of invoices) {
      const date = inv.issuedAt.toISOString().split("T")[0];
      byDate.set(date, (byDate.get(date) ?? 0) + inv.totalCents);
      byKind.set(inv.kind, (byKind.get(inv.kind) ?? 0) + inv.totalCents);
    }

    return {
      period,
      data: [...byDate.entries()].map(([date, amountCents]) => ({
        date,
        amountCents,
      })),
      byKind: [...byKind.entries()].map(([kind, amountCents]) => ({
        kind,
        amountCents,
      })),
      totalCents: invoices.reduce((sum, i) => sum + i.totalCents, 0),
    };
  }

  async getGrowthMetrics() {
    const now = new Date();
    const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const [
      tenantsThisMonth,
      tenantsLastMonth,
      usersThisMonth,
      usersLastMonth,
      ordersThisMonth,
      ordersLastMonth,
    ] = await Promise.all([
      this.prisma.tenant.count({
        where: { createdAt: { gte: lastMonth } },
      }),
      this.prisma.tenant.count({
        where: {
          createdAt: { gte: twoMonthsAgo, lt: lastMonth },
        },
      }),
      this.prisma.user.count({
        where: { createdAt: { gte: lastMonth } },
      }),
      this.prisma.user.count({
        where: {
          createdAt: { gte: twoMonthsAgo, lt: lastMonth },
        },
      }),
      this.prisma.order.count({
        where: { createdAt: { gte: lastMonth } },
      }),
      this.prisma.order.count({
        where: {
          createdAt: { gte: twoMonthsAgo, lt: lastMonth },
        },
      }),
    ]);

    const calculateGrowth = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return {
      tenants: {
        current: tenantsThisMonth,
        previous: tenantsLastMonth,
        growth: calculateGrowth(tenantsThisMonth, tenantsLastMonth),
      },
      users: {
        current: usersThisMonth,
        previous: usersLastMonth,
        growth: calculateGrowth(usersThisMonth, usersLastMonth),
      },
      orders: {
        current: ordersThisMonth,
        previous: ordersLastMonth,
        growth: calculateGrowth(ordersThisMonth, ordersLastMonth),
      },
    };
  }

  /**
   * Which products are actually selling. Replaces plan distribution, which
   * could only ever answer "which of the four tiers", a question with no
   * meaning once tiers stopped existing.
   */
  async getProductDistribution() {
    const grouped = await this.prisma.tenantAddOn.groupBy({
      by: ["addOnId"],
      where: { status: "active" },
      _count: true,
      _sum: { quantity: true },
    });
    if (grouped.length === 0) return [];

    const addOns = await this.prisma.marketplaceAddOn.findMany({
      where: { id: { in: grouped.map((g) => g.addOnId) } },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        priceCents: true,
      },
    });
    const byId = new Map(addOns.map((a) => [a.id, a]));

    return grouped
      .map((g) => {
        const addOn = byId.get(g.addOnId);
        const units = g._sum.quantity ?? g._count;
        return {
          addOnId: g.addOnId,
          code: addOn?.code ?? "unknown",
          name: addOn?.name ?? "Unknown",
          kind: addOn?.kind ?? "unknown",
          tenants: g._count,
          units,
          annualValueCents: (addOn?.priceCents ?? 0) * units,
        };
      })
      .sort((a, b) => b.tenants - a.tenants);
  }

  async getRecentActivity(limit: number = 10) {
    const [recentTenants, recentUsers, recentPurchases] = await Promise.all([
      this.prisma.tenant.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          createdAt: true,
          tenant: {
            select: { name: true },
          },
        },
      }),
      this.prisma.tenantAddOn.findMany({
        orderBy: { activatedAt: "desc" },
        take: limit,
        select: {
          id: true,
          tenantId: true,
          status: true,
          origin: true,
          quantity: true,
          chargedCents: true,
          currentPeriodEnd: true,
          activatedAt: true,
          addOn: { select: { code: true, name: true, kind: true } },
        },
      }),
    ]);

    // TenantAddOn carries only tenantId — there is no relation to follow, so
    // the names come from one extra scoped read rather than N.
    const tenantNames = new Map(
      (
        await this.prisma.tenant.findMany({
          where: { id: { in: recentPurchases.map((p) => p.tenantId) } },
          select: { id: true, name: true },
        })
      ).map((t) => [t.id, t.name]),
    );

    return {
      recentTenants,
      recentUsers,
      recentPurchases: recentPurchases.map((p) => ({
        ...p,
        tenantName: tenantNames.get(p.tenantId) ?? null,
      })),
    };
  }

  async getAlerts() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      expiringLicences,
      lapsedProducts,
      suspendedTenants,
      failedCheckouts,
    ] = await Promise.all([
      // Licences whose anniversary lands inside the week. Renewal is manual,
      // so these are the accounts that need a human nudge.
      this.prisma.tenantAddOn.count({
        where: {
          status: "active",
          addOn: { kind: "license" },
          currentPeriodEnd: { gte: now, lte: sevenDaysFromNow },
        },
      }),
      // Already past the anniversary and inside grace: capability is still
      // live but about to go dark.
      this.prisma.tenantAddOn.count({ where: { status: "past_due" } }),
      this.prisma.tenant.count({ where: { status: "SUSPENDED" } }),
      // Money that tried to arrive and didn't.
      this.prisma.checkoutIntent.count({
        where: {
          status: "failed",
          createdAt: { gte: sevenDaysAgo },
        },
      }),
    ]);

    return {
      expiringLicences,
      lapsedProducts,
      suspendedTenants,
      failedCheckouts,
    };
  }
}
