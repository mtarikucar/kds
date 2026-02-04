import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

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
      totalSubscriptions,
      activeSubscriptions,
      trialSubscriptions,
    ] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenant.count({ where: { status: 'SUSPENDED' } }),
      this.prisma.user.count(),
      this.prisma.order.count({ where: { status: 'PAID' } }),
      this.prisma.subscription.count(),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { isTrialPeriod: true } }),
    ]);

    // Calculate MRR (Monthly Recurring Revenue)
    const activeMonthlySubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
      },
      select: { amount: true },
    });

    const activeYearlySubscriptions = await this.prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        billingCycle: 'YEARLY',
      },
      select: { amount: true },
    });

    const monthlyRevenue = activeMonthlySubscriptions.reduce(
      (sum, sub) => sum + Number(sub.amount),
      0,
    );
    const yearlyMonthlyEquivalent =
      activeYearlySubscriptions.reduce(
        (sum, sub) => sum + Number(sub.amount),
        0,
      ) / 12;

    const mrr = monthlyRevenue + yearlyMonthlyEquivalent;

    return {
      tenants: {
        total: totalTenants,
        active: activeTenants,
        suspended: suspendedTenants,
      },
      users: {
        total: totalUsers,
      },
      orders: {
        total: totalOrders,
      },
      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        trial: trialSubscriptions,
      },
      revenue: {
        mrr: Math.round(mrr * 100) / 100,
      },
    };
  }

  async getRevenueAnalytics(period: 'week' | 'month' | 'year' = 'month') {
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
    }

    const payments = await this.prisma.subscriptionPayment.findMany({
      where: {
        status: 'SUCCEEDED',
        paidAt: {
          gte: startDate,
        },
      },
      select: {
        amount: true,
        paidAt: true,
      },
      orderBy: { paidAt: 'asc' },
    });

    // Group by date
    const revenueByDate = payments.reduce((acc, payment) => {
      const date = payment.paidAt.toISOString().split('T')[0];
      acc[date] = (acc[date] || 0) + Number(payment.amount);
      return acc;
    }, {} as Record<string, number>);

    return {
      period,
      data: Object.entries(revenueByDate).map(([date, amount]) => ({
        date,
        amount,
      })),
      total: payments.reduce((sum, p) => sum + Number(p.amount), 0),
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

  async getPlanDistribution() {
    const subscriptions = await this.prisma.subscription.groupBy({
      by: ['planId'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    const plans = await this.prisma.subscriptionPlan.findMany({
      select: { id: true, name: true, displayName: true },
    });

    const planMap = new Map(plans.map((p) => [p.id, p]));

    return subscriptions.map((sub) => {
      const plan = planMap.get(sub.planId);
      return {
        planId: sub.planId,
        planName: plan?.name || 'Unknown',
        planDisplayName: plan?.displayName || 'Unknown',
        count: sub._count,
      };
    });
  }

  async getRecentActivity(limit: number = 10) {
    const [recentTenants, recentUsers, recentSubscriptions] = await Promise.all(
      [
        this.prisma.tenant.findMany({
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
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
        this.prisma.subscription.findMany({
          orderBy: { createdAt: 'desc' },
          take: limit,
          select: {
            id: true,
            status: true,
            billingCycle: true,
            createdAt: true,
            tenant: {
              select: { name: true },
            },
            plan: {
              select: { name: true, displayName: true },
            },
          },
        }),
      ],
    );

    return {
      recentTenants,
      recentUsers,
      recentSubscriptions,
    };
  }

  async getAlerts() {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [expiringTrials, suspendedTenants, failedPayments] = await Promise.all(
      [
        // Trials ending in 7 days
        this.prisma.subscription.count({
          where: {
            isTrialPeriod: true,
            trialEnd: {
              gte: now,
              lte: sevenDaysFromNow,
            },
          },
        }),
        // Suspended tenants
        this.prisma.tenant.count({
          where: { status: 'SUSPENDED' },
        }),
        // Failed payments in last 7 days
        this.prisma.subscriptionPayment.count({
          where: {
            status: 'FAILED',
            createdAt: {
              gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
      ],
    );

    return {
      expiringTrials,
      suspendedTenants,
      failedPayments,
    };
  }
}
