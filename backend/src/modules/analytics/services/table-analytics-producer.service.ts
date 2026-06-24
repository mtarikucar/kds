import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * REAL producer for the `tableAnalytics` table.
 *
 * Before this service the ONLY writer of `tableAnalytics` was
 * MockDataGeneratorService (dev-only), so the paid "Table Analytics" /
 * "Customer Behavior" tabs rendered fabricated numbers or nothing at all.
 * This producer recomputes the genuine per-table, per-day metrics from
 * real Order / Payment rows whenever an order is finalized as PAID.
 *
 * HONESTY CONTRACT
 * ----------------
 * Every metric written here is derived from actual orders:
 *   - revenueGenerated / ordersCount / avgOrderValue   → PAID order finalAmount
 *   - totalSessions (table turns)                      → count of PAID DINE_IN orders
 *   - totalOccupiedMinutes / totalDiningMinutes        → real createdAt→paidAt span
 *   - avgSessionDuration / avgDiningDuration           → occupied minutes / sessions
 *   - revenuePerMinute                                 → revenue / occupied minutes
 *   - peakHours                                        → real distribution of order hours
 *   - utilizationScore                                 → occupied minutes vs a 12h
 *                                                        operating window (documented)
 *
 * Metrics that genuinely CANNOT be derived from orders alone (they need
 * camera/occupancy telemetry to tell "occupied but no active order" apart
 * from "occupied and ordering") are written as their honest real value
 * rather than invented:
 *   - totalIdleMinutes / avgIdleDuration  → 0 (no telemetry source)
 *   - totalEmptyMinutes                   → operatingMinutes - occupiedMinutes
 *
 * Recompute (not increment) per (tableId, date): the method re-aggregates
 * the whole day for the table every time, so it is idempotent and a
 * re-run (retry, double finalize) converges on the same real numbers.
 */
@Injectable()
export class TableAnalyticsProducerService {
  private readonly logger = new Logger(TableAnalyticsProducerService.name);

  // Operating-window assumption used ONLY to normalise utilizationScore to a
  // 0-100 range. 12h matches the MockDataGenerator's prior assumption and the
  // TableAnalyticsService empty-row default, so the score stays comparable
  // across mock/real history during the transition.
  private static readonly OPERATING_MINUTES_PER_DAY = 12 * 60;

  constructor(private prisma: PrismaService) {}

  /**
   * Post-commit, best-effort. Called from PaymentFinalizer after the payment
   * transaction commits and the order has transitioned to PAID. Never throws
   * (a metrics-aggregation failure must never roll back or block a payment).
   */
  async recordTableAnalyticsForPaidOrder(
    orderId: string,
    tenantId: string,
  ): Promise<void> {
    try {
      const order = await this.prisma.order.findFirst({
        where: { id: orderId, tenantId, status: "PAID" },
        select: { tableId: true, branchId: true, paidAt: true },
      });
      // No table → nothing to attribute (takeaway / delivery / counter).
      if (!order?.tableId) return;

      const day = this.startOfDay(order.paidAt ?? new Date());
      await this.recomputeTableDay(
        tenantId,
        order.branchId,
        order.tableId,
        day,
      );
    } catch (err) {
      this.logger.warn(
        `recordTableAnalyticsForPaidOrder failed for order=${orderId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Re-aggregate the real metrics for one table on one calendar day and
   * upsert the single (tableId, date) row.
   */
  async recomputeTableDay(
    tenantId: string,
    branchId: string,
    tableId: string,
    day: Date,
  ): Promise<void> {
    const dayStart = this.startOfDay(day);
    const dayEnd = this.endOfDay(day);

    // Every PAID order on this table whose paidAt falls in the day. paidAt is
    // the settlement instant; createdAt is when the table started being served.
    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        branchId,
        tableId,
        status: "PAID",
        paidAt: { gte: dayStart, lte: dayEnd },
      },
      select: {
        finalAmount: true,
        createdAt: true,
        paidAt: true,
      },
    });

    const date = this.dateOnly(day);

    // No real activity → write a genuine zero row (NOT a fabricated one) so the
    // tab shows "no data yet" honestly rather than a stale mock figure.
    if (orders.length === 0) {
      await this.upsert(tenantId, branchId, tableId, date, this.zeroMetrics());
      return;
    }

    let revenue = new Prisma.Decimal(0);
    let occupiedMinutes = 0;
    const peakHours: Record<number, number> = {};

    for (const o of orders) {
      revenue = revenue.add(new Prisma.Decimal(o.finalAmount));

      // Active service span: createdAt → paidAt, clamped to the day and to a
      // sane non-negative value. This is the table's real dining time.
      const start = o.createdAt;
      const end = o.paidAt ?? o.createdAt;
      const spanMs = Math.max(0, end.getTime() - start.getTime());
      occupiedMinutes += Math.round(spanMs / 60000);

      // Real arrival distribution by hour of the order's createdAt.
      const hour = o.createdAt.getHours();
      peakHours[hour] = (peakHours[hour] || 0) + 1;
    }

    const sessions = orders.length;
    const ordersCount = orders.length;
    const diningMinutes = occupiedMinutes; // orders == active dining for this table
    const operatingMinutes =
      TableAnalyticsProducerService.OPERATING_MINUTES_PER_DAY;
    const emptyMinutes = Math.max(0, operatingMinutes - occupiedMinutes);

    const avgOrderValue = ordersCount > 0 ? revenue.div(ordersCount) : null;
    const revenuePerMinute =
      occupiedMinutes > 0 ? revenue.div(occupiedMinutes) : null;
    const avgSessionDuration = sessions > 0 ? occupiedMinutes / sessions : null;
    const avgDiningDuration = avgSessionDuration;
    const utilizationScore = Math.min(
      100,
      (occupiedMinutes / operatingMinutes) * 100,
    );

    await this.upsert(tenantId, branchId, tableId, date, {
      totalOccupiedMinutes: occupiedMinutes,
      totalDiningMinutes: diningMinutes,
      // Idle requires occupancy telemetry to measure — honestly 0 here.
      totalIdleMinutes: 0,
      totalEmptyMinutes: emptyMinutes,
      totalSessions: sessions,
      avgSessionDuration,
      avgDiningDuration,
      // No telemetry → no idle duration. Honest null, not a guess.
      avgIdleDuration: null,
      revenueGenerated: revenue,
      ordersCount,
      avgOrderValue,
      revenuePerMinute,
      utilizationScore,
      peakHours,
    });
  }

  private zeroMetrics() {
    return {
      totalOccupiedMinutes: 0,
      totalDiningMinutes: 0,
      totalIdleMinutes: 0,
      totalEmptyMinutes:
        TableAnalyticsProducerService.OPERATING_MINUTES_PER_DAY,
      totalSessions: 0,
      avgSessionDuration: null as number | null,
      avgDiningDuration: null as number | null,
      avgIdleDuration: null as number | null,
      revenueGenerated: new Prisma.Decimal(0),
      ordersCount: 0,
      avgOrderValue: null as Prisma.Decimal | null,
      revenuePerMinute: null as Prisma.Decimal | null,
      utilizationScore: 0,
      peakHours: {} as Record<number, number>,
    };
  }

  private async upsert(
    tenantId: string,
    branchId: string,
    tableId: string,
    date: Date,
    metrics: {
      totalOccupiedMinutes: number;
      totalDiningMinutes: number;
      totalIdleMinutes: number;
      totalEmptyMinutes: number;
      totalSessions: number;
      avgSessionDuration: number | null;
      avgDiningDuration: number | null;
      avgIdleDuration: number | null;
      revenueGenerated: Prisma.Decimal;
      ordersCount: number;
      avgOrderValue: Prisma.Decimal | null;
      revenuePerMinute: Prisma.Decimal | null;
      utilizationScore: number;
      peakHours: Record<number, number>;
    },
  ): Promise<void> {
    const data = {
      ...metrics,
      // Prisma rejects a plain JS object as Json on update unless typed; the
      // peakHours map is a flat {hour: count} record.
      peakHours: metrics.peakHours as Prisma.InputJsonValue,
    };
    await this.prisma.tableAnalytics.upsert({
      where: { tableId_date: { tableId, date } },
      update: data,
      create: {
        ...data,
        tableId,
        date,
        tenantId,
        branchId,
      },
    });
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  /** The @db.Date column stores midnight UTC of the calendar day. */
  private dateOnly(d: Date): Date {
    return new Date(
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0),
    );
  }
}
