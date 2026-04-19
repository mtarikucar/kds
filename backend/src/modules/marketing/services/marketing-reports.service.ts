import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReportFilterDto } from '../dto/report-filter.dto';

@Injectable()
export class MarketingReportsService {
  constructor(private prisma: PrismaService) {}

  async getPerformanceReport(filter: ReportFilterDto) {
    const dateFilter: any = {};
    if (filter.dateFrom) dateFilter.gte = new Date(filter.dateFrom);
    if (filter.dateTo) dateFilter.lte = new Date(filter.dateTo);

    const reps = await this.prisma.marketingUser.findMany({
      where: {
        status: 'ACTIVE',
        ...(filter.marketingUserId ? { id: filter.marketingUserId } : {}),
      },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    const performance = await Promise.all(
      reps.map(async (rep) => {
        const leadWhere: any = { assignedToId: rep.id };
        if (Object.keys(dateFilter).length) leadWhere.createdAt = dateFilter;

        const activityWhere: any = { createdById: rep.id };
        if (Object.keys(dateFilter).length) activityWhere.createdAt = dateFilter;

        const [totalLeads, wonLeads, lostLeads, activities, demos, meetings] =
          await Promise.all([
            this.prisma.lead.count({ where: leadWhere }),
            this.prisma.lead.count({ where: { ...leadWhere, status: 'WON' } }),
            this.prisma.lead.count({ where: { ...leadWhere, status: 'LOST' } }),
            this.prisma.leadActivity.count({ where: activityWhere }),
            this.prisma.leadActivity.count({ where: { ...activityWhere, type: 'DEMO' } }),
            this.prisma.leadActivity.count({ where: { ...activityWhere, type: 'MEETING' } }),
          ]);

        const totalProcessed = wonLeads + lostLeads;
        const conversionRate = totalProcessed > 0 ? (wonLeads / totalProcessed) * 100 : 0;

        return {
          rep: { id: rep.id, name: `${rep.firstName} ${rep.lastName}`, role: rep.role },
          totalLeads,
          wonLeads,
          lostLeads,
          activities,
          demos,
          meetings,
          conversionRate: Math.round(conversionRate * 100) / 100,
        };
      }),
    );

    return performance;
  }

  async getLeadSourceReport(filter: ReportFilterDto) {
    const where: any = {};
    if (filter.dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(filter.dateFrom) };
    if (filter.dateTo) where.createdAt = { ...where.createdAt, lte: new Date(filter.dateTo) };

    const sources = [
      'INSTAGRAM', 'REFERRAL', 'FIELD_VISIT', 'ADS', 'WEBSITE', 'PHONE', 'OTHER',
    ];

    const data = await Promise.all(
      sources.map(async (source) => {
        const [total, won, lost] = await Promise.all([
          this.prisma.lead.count({ where: { ...where, source } }),
          this.prisma.lead.count({ where: { ...where, source, status: 'WON' } }),
          this.prisma.lead.count({ where: { ...where, source, status: 'LOST' } }),
        ]);

        const processed = won + lost;
        const conversionRate = processed > 0 ? (won / processed) * 100 : 0;

        return {
          source,
          total,
          won,
          lost,
          conversionRate: Math.round(conversionRate * 100) / 100,
        };
      }),
    );

    return data.filter((d) => d.total > 0);
  }

  async getRegionalReport(filter: ReportFilterDto) {
    const where: any = {};
    if (filter.dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(filter.dateFrom) };
    if (filter.dateTo) where.createdAt = { ...where.createdAt, lte: new Date(filter.dateTo) };

    // Batch: total by city
    const totals = await this.prisma.lead.groupBy({
      by: ['city'],
      where: { ...where, city: { not: null } },
      _count: { id: true },
    });

    // Batch: won by city (single query instead of N+1)
    const wonTotals = await this.prisma.lead.groupBy({
      by: ['city'],
      where: { ...where, city: { not: null }, status: 'WON' },
      _count: { id: true },
    });

    const wonMap = new Map(wonTotals.map((w) => [w.city, w._count.id]));

    const data = totals.map((group) => ({
      city: group.city,
      total: group._count.id,
      won: wonMap.get(group.city) || 0,
    }));

    return data.sort((a, b) => b.total - a.total);
  }

  async getConversionFunnel(filter: ReportFilterDto) {
    const where: any = {};
    if (filter.dateFrom) where.createdAt = { ...where.createdAt, gte: new Date(filter.dateFrom) };
    if (filter.dateTo) where.createdAt = { ...where.createdAt, lte: new Date(filter.dateTo) };

    const statuses = [
      'NEW', 'CONTACTED', 'MEETING_DONE', 'DEMO_SCHEDULED', 'OFFER_SENT', 'WON', 'LOST',
    ];

    const funnel = await Promise.all(
      statuses.map(async (status) => ({
        status,
        count: await this.prisma.lead.count({ where: { ...where, status } }),
      })),
    );

    return funnel;
  }
}
