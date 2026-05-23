import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Branch-health score. The number ops actually wants on their dashboard.
 *
 * Composite of three sub-scores in [0,1] equally weighted:
 *   - device_online_pct  : how many devices for the branch are currently online
 *   - last_successful_fiscal_age_minutes : monotonically penalised after 60 min
 *   - last_successful_order_age_minutes  : same shape, after 15 min
 *
 * The result is 0..100 (rounded) and a colour pill:
 *   ≥ 85 green ; 60..84 yellow ; < 60 red
 *
 * Cheap to compute (three indexed queries per branch) so we can call it on
 * every dashboard load without caching for MVP.
 */
@Injectable()
export class HealthDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async branchScore(tenantId: string, branchId: string) {
    // Confirm the branch actually belongs to this tenant before scoring.
    // The downstream queries are already tenant-scoped so cross-tenant
    // data leakage is impossible — but without this preliminary check the
    // response is just empty stats for a wrong branchId, which the UI
    // would render as "this branch has nothing", confusing operators.
    // A 404 makes the bug visible.
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException('Branch not found for this tenant');

    const [devices, lastFiscal, lastOrder] = await Promise.all([
      this.prisma.device.findMany({
        where: { tenantId, branchId, status: { notIn: ['retired'] } },
        select: { status: true },
      }),
      this.prisma.fiscalReceipt.findFirst({
        where: { tenantId, status: 'issued' },
        orderBy: { issuedAt: 'desc' },
        select: { issuedAt: true },
      }),
      this.prisma.order.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const onlinePct = devices.length === 0
      ? 1
      : devices.filter((d) => d.status === 'online').length / devices.length;

    const minutesSince = (d?: Date | null) =>
      d ? Math.max(0, (Date.now() - new Date(d).getTime()) / 60_000) : Number.POSITIVE_INFINITY;

    const fiscalAge = minutesSince(lastFiscal?.issuedAt ?? null);
    const orderAge = minutesSince(lastOrder?.createdAt ?? null);

    // Linear penalty above thresholds, floor at 0.
    const fiscalScore = fiscalAge === Number.POSITIVE_INFINITY ? 0.5 : Math.max(0, 1 - Math.max(0, fiscalAge - 60) / 240);
    const orderScore = orderAge === Number.POSITIVE_INFINITY ? 0.5 : Math.max(0, 1 - Math.max(0, orderAge - 15) / 120);

    const composite = (onlinePct + fiscalScore + orderScore) / 3;
    const score = Math.round(composite * 100);
    const pill = score >= 85 ? 'green' : score >= 60 ? 'yellow' : 'red';

    return {
      branchId,
      score,
      pill,
      breakdown: {
        devicesOnlinePct: Math.round(onlinePct * 100),
        fiscalAgeMinutes: Number.isFinite(fiscalAge) ? Math.round(fiscalAge) : null,
        orderAgeMinutes: Number.isFinite(orderAge) ? Math.round(orderAge) : null,
      },
      countedDevices: devices.length,
    };
  }

  async tenantOverview(tenantId: string) {
    const branches = await this.prisma.branch.findMany({
      where: { tenantId, status: 'active' },
      select: { id: true, name: true },
    });
    const scores = await Promise.all(branches.map((b) => this.branchScore(tenantId, b.id)));
    return branches.map((b, i) => ({ ...b, health: scores[i] }));
  }
}
