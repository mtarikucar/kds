import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class MarketingDashboardService {
  constructor(private prisma: PrismaService) {}

  async getStats(userId: string, userRole: string) {
    const where = userRole === 'SALES_REP' ? { assignedToId: userId } : {};

    const [
      totalLeads,
      newLeads,
      wonLeads,
      lostLeads,
      activeOffers,
      pendingTasks,
    ] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.count({ where: { ...where, status: 'NEW' } }),
      this.prisma.lead.count({ where: { ...where, status: 'WON' } }),
      this.prisma.lead.count({ where: { ...where, status: 'LOST' } }),
      this.prisma.leadOffer.count({
        where: {
          status: { in: ['DRAFT', 'SENT'] },
          ...(userRole === 'SALES_REP' ? { createdById: userId } : {}),
        },
      }),
      this.prisma.marketingTask.count({
        where: {
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          ...(userRole === 'SALES_REP' ? { assignedToId: userId } : {}),
        },
      }),
    ]);

    const totalProcessed = wonLeads + lostLeads;
    const conversionRate = totalProcessed > 0 ? (wonLeads / totalProcessed) * 100 : 0;

    return {
      totalLeads,
      newLeads,
      wonLeads,
      lostLeads,
      activeOffers,
      pendingTasks,
      conversionRate: Math.round(conversionRate * 100) / 100,
    };
  }

  async getLeadsByStatus(userId: string, userRole: string) {
    const where = userRole === 'SALES_REP' ? { assignedToId: userId } : {};

    // Use groupBy instead of N separate count queries
    const grouped = await this.prisma.lead.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });

    const allStatuses = [
      'NEW', 'CONTACTED', 'NOT_REACHABLE', 'MEETING_DONE',
      'DEMO_SCHEDULED', 'OFFER_SENT', 'WAITING', 'WON', 'LOST',
    ];

    const countMap = new Map(grouped.map((g) => [g.status, g._count.id]));

    return allStatuses.map((status) => ({
      status,
      count: countMap.get(status) || 0,
    }));
  }

  async getTodaySummary(userId: string, userRole: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const taskWhere: any = {
      dueDate: { gte: today, lt: tomorrow },
      status: { not: 'CANCELLED' },
    };

    const activityWhere: any = {
      createdAt: { gte: today, lt: tomorrow },
    };

    if (userRole === 'SALES_REP') {
      taskWhere.assignedToId = userId;
      activityWhere.createdById = userId;
    }

    const [todayTasks, completedTasks, todayActivities, overdueTasks] = await Promise.all([
      this.prisma.marketingTask.count({ where: taskWhere }),
      this.prisma.marketingTask.count({
        where: { ...taskWhere, status: 'COMPLETED' },
      }),
      this.prisma.leadActivity.count({ where: activityWhere }),
      this.prisma.marketingTask.count({
        where: {
          dueDate: { lt: today },
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          ...(userRole === 'SALES_REP' ? { assignedToId: userId } : {}),
        },
      }),
    ]);

    return {
      todayTasks,
      completedTasks,
      todayActivities,
      overdueTasks,
    };
  }

  async getMonthlyMetrics(userId: string, userRole: string) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const where = userRole === 'SALES_REP' ? { assignedToId: userId } : {};

    const [newLeads, wonLeads, activitiesCount] = await Promise.all([
      this.prisma.lead.count({
        where: { ...where, createdAt: { gte: firstDay, lte: lastDay } },
      }),
      this.prisma.lead.count({
        where: { ...where, status: 'WON', convertedAt: { gte: firstDay, lte: lastDay } },
      }),
      this.prisma.leadActivity.count({
        where: {
          createdAt: { gte: firstDay, lte: lastDay },
          ...(userRole === 'SALES_REP' ? { createdById: userId } : {}),
        },
      }),
    ]);

    return {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      newLeads,
      wonLeads,
      activitiesCount,
    };
  }

  async getTopPerformers(limit = 10) {
    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

    // Single query: get reps with counts
    const reps = await this.prisma.marketingUser.findMany({
      where: { role: 'SALES_REP', status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        _count: {
          select: { leads: true, activities: true },
        },
      },
    });

    if (reps.length === 0) return [];

    // Batch query for won leads this month instead of N+1
    const wonCounts = await this.prisma.lead.groupBy({
      by: ['assignedToId'],
      where: {
        assignedToId: { in: reps.map((r) => r.id) },
        status: 'WON',
        convertedAt: { gte: firstDay },
      },
      _count: { id: true },
    });

    const wonMap = new Map(
      wonCounts.map((w) => [w.assignedToId, w._count.id]),
    );

    return reps
      .map((rep) => ({
        id: rep.id,
        name: `${rep.firstName} ${rep.lastName}`,
        totalLeads: rep._count.leads,
        totalActivities: rep._count.activities,
        wonThisMonth: wonMap.get(rep.id) || 0,
      }))
      .sort((a, b) => b.wonThisMonth - a.wonThisMonth)
      .slice(0, limit);
  }
}
