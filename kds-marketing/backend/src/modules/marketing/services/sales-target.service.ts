import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SetTargetDto,
  TargetFilterDto,
  TargetMetric,
  TARGET_METRICS,
} from '../dto/sales-target.dto';
import { MarketingUserPayload } from '../types';

export interface MetricPerformance {
  metric: TargetMetric;
  target: number | null;
  actual: number;
  attainmentPct: number | null;
}

/**
 * Phase 4 sales targets/quotas + performance-vs-target. A manager sets a
 * per-rep, per-period (YYYY-MM) target; performance is computed from
 * marketing-owned data only (won leads, commission amounts, connected calls) —
 * no core access.
 */
@Injectable()
export class SalesTargetService {
  constructor(private readonly prisma: PrismaService) {}

  /** Manager sets (or updates) a rep's target for a period+metric. */
  setTarget(dto: SetTargetDto, setById: string) {
    return this.prisma.salesTarget.upsert({
      where: {
        marketingUserId_period_metric: {
          marketingUserId: dto.marketingUserId,
          period: dto.period,
          metric: dto.metric,
        },
      },
      create: {
        marketingUserId: dto.marketingUserId,
        period: dto.period,
        metric: dto.metric,
        targetValue: dto.targetValue,
        notes: dto.notes ?? null,
        setById,
      },
      update: {
        targetValue: dto.targetValue,
        notes: dto.notes ?? null,
        setById,
      },
    });
  }

  list(filter: TargetFilterDto, user: MarketingUserPayload) {
    const where: Prisma.SalesTargetWhereInput = {};
    if (user.role === 'SALES_REP') {
      where.marketingUserId = user.id; // reps see only their own targets
    } else if (filter.marketingUserId) {
      where.marketingUserId = filter.marketingUserId;
    }
    if (filter.period) where.period = filter.period;
    return this.prisma.salesTarget.findMany({
      where,
      orderBy: [{ period: 'desc' }, { metric: 'asc' }],
    });
  }

  async remove(id: string) {
    const target = await this.prisma.salesTarget.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Target not found');
    await this.prisma.salesTarget.delete({ where: { id } });
    return { deleted: true };
  }

  /** Performance vs target for a rep + period across every metric. */
  async performanceFor(marketingUserId: string, period: string): Promise<MetricPerformance[]> {
    const targets = await this.prisma.salesTarget.findMany({
      where: { marketingUserId, period },
    });
    const targetByMetric = new Map(targets.map((t) => [t.metric, t]));
    const actuals = await this.actualsFor(marketingUserId, period);

    return TARGET_METRICS.map((metric) => {
      const target = targetByMetric.get(metric);
      const targetValue = target ? Number(target.targetValue) : null;
      const actual = actuals[metric];
      const attainmentPct =
        targetValue && targetValue > 0
          ? Math.round((actual / targetValue) * 10000) / 100
          : null;
      return { metric, target: targetValue, actual, attainmentPct };
    });
  }

  /** Whole-team attainment for a period (managers). */
  async teamPerformance(period: string) {
    const reps = await this.prisma.marketingUser.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: { firstName: 'asc' },
    });
    return Promise.all(
      reps.map(async (rep) => ({
        marketingUser: rep,
        metrics: await this.performanceFor(rep.id, period),
      })),
    );
  }

  private async actualsFor(
    marketingUserId: string,
    period: string,
  ): Promise<Record<TargetMetric, number>> {
    const { start, end } = this.periodRange(period);
    const [wonLeads, commissionAgg, connectedCalls] = await Promise.all([
      this.prisma.lead.count({
        where: {
          assignedToId: marketingUserId,
          status: 'WON',
          convertedAt: { gte: start, lt: end },
        },
      }),
      this.prisma.commission.aggregate({
        where: { marketingUserId, period },
        _sum: { amount: true },
      }),
      this.prisma.salesCall.count({
        where: {
          marketingUserId,
          status: 'CONNECTED',
          startedAt: { gte: start, lt: end },
        },
      }),
    ]);
    return {
      WON_LEADS: wonLeads,
      COMMISSION_AMOUNT: Number(commissionAgg._sum.amount ?? 0),
      CONNECTED_CALLS: connectedCalls,
    };
  }

  /** [start, end) UTC bounds for a YYYY-MM period. */
  private periodRange(period: string): { start: Date; end: Date } {
    const [y, m] = period.split('-').map(Number);
    return {
      start: new Date(Date.UTC(y, m - 1, 1)),
      end: new Date(Date.UTC(y, m, 1)),
    };
  }
}
