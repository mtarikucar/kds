import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { OrderStatus } from "../../common/constants/order-status.enum";
import { getTenantMidnight } from "../../common/helpers/timezone.helper";
import { toCsv } from "../../common/utils/csv.util";

/**
 * Hard cap on the explicit date window a single report call can request.
 * Everything past the cap is rejected at getDateRange.
 *
 * getSalesSummary / getOrdersByHour / getCustomerAnalytics all run
 * findMany over PAID Orders inside the window and bucket in JS. A
 * tenant with even modest order volume (1K/day) hits 366K rows for a
 * 1-year window — already at the edge of comfortable memory pressure.
 * Letting an admin pass `startDate=2020-01-01` (effectively "all time")
 * was a one-request DoS lever. 366 days covers every real reporting
 * use case (calendar-year comparisons, leap-year edge cases) while
 * keeping per-call memory bounded.
 */
const REPORT_MAX_WINDOW_DAYS = 366;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convert a Prisma Decimal to a JSON-safe number while preserving full
 * cent precision. Floating-point arithmetic on Decimal values previously
 * accumulated rounding error: 0.1+0.2=0.30000000000000004 on every
 * `+= Number(order.finalAmount)`. Going through .toFixed(2) is the safest
 * way to land back in JS-number land without leaking IEEE-754 dust into
 * the reports payload.
 */
function decimalToCents(d: Prisma.Decimal | number | null | undefined): number {
  if (d == null) return 0;
  // Round to the smallest currency unit. Prisma Decimal supports
  // `.mul(100).round().toNumber()` which is exact for the 2-decimal
  // monetary scale we use; intermediate value stays within MAX_SAFE_INTEGER
  // for the foreseeable future (90 quadrillion kuruş).
  const dec = d instanceof Prisma.Decimal ? d : new Prisma.Decimal(d);
  return dec.mul(100).round().toNumber();
}

function centsToCurrency(cents: number): number {
  // /100 is exact for values < 2^53/100 ≈ 90 trillion units.
  return Math.round(cents) / 100;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Look up the tenant timezone and compute today's [start, end) bounds in
   * that TZ so a report for "today" means the restaurant's day, not the
   * server pod's day. Defaults to UTC if the tenant has no timezone set.
   */
  private async getDateRange(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    if (startDate && endDate) {
      // Validate dates are sensible — Date constructed from a malformed
      // ISO string is `Invalid Date` (getTime() → NaN), which would make
      // every downstream gte/lte comparison return false silently.
      if (
        Number.isNaN(startDate.getTime()) ||
        Number.isNaN(endDate.getTime())
      ) {
        throw new BadRequestException(
          "startDate / endDate must be valid dates",
        );
      }
      if (startDate > endDate) {
        throw new BadRequestException(
          "startDate must be before or equal to endDate",
        );
      }
      const windowDays =
        (endDate.getTime() - startDate.getTime()) / MILLIS_PER_DAY;
      if (windowDays > REPORT_MAX_WINDOW_DAYS) {
        throw new BadRequestException(
          `Date range cannot exceed ${REPORT_MAX_WINDOW_DAYS} days. Split the report into smaller windows.`,
        );
      }
      return { start: startDate, end: endDate };
    }
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const tz = tenant?.timezone || "UTC";
    const now = new Date();
    const start = startDate ?? getTenantMidnight(now, tz);
    const end =
      endDate ??
      getTenantMidnight(new Date(now.getTime() + MILLIS_PER_DAY), tz);
    return { start, end };
  }

  async getSalesSummary(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    // branchScope is spread into every order.where so the same expression
    // covers tenant-wide (no branchId) and branch-scoped reads. Null-branch
    // legacy orders are excluded from branch-scoped totals by construction.
    const branchScope = branchId ? { branchId } : {};

    // Get aggregated order data
    const orderStats = await this.prisma.order.aggregate({
      where: {
        tenantId,
        ...branchScope,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      _sum: {
        finalAmount: true,
        discount: true,
      },
      _count: true,
    });

    const totalSalesCents = decimalToCents(orderStats._sum.finalAmount);
    const totalSales = centsToCurrency(totalSalesCents);
    const totalOrders = orderStats._count;
    const averageOrderValue =
      totalOrders > 0
        ? centsToCurrency(Math.round(totalSalesCents / totalOrders))
        : 0;
    const totalDiscount = centsToCurrency(
      decimalToCents(orderStats._sum.discount),
    );

    // Get payment method breakdown
    const paymentBreakdown = await this.prisma.payment.groupBy({
      by: ["method"],
      where: {
        order: {
          tenantId,
          ...branchScope,
          status: OrderStatus.PAID,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
        status: "COMPLETED",
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const paymentMethodBreakdown = paymentBreakdown.map((pm) => ({
      method: pm.method,
      total: centsToCurrency(decimalToCents(pm._sum.amount)),
      count: pm._count,
    }));

    // Get daily sales breakdown
    const paidOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...branchScope,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      select: {
        createdAt: true,
        finalAmount: true,
      },
    });

    // Accumulate in integer cents so a long tail of orders doesn't bleed
    // IEEE-754 dust into the daily totals (which the dashboard then
    // diffs day-over-day and renders as "0.000001" deltas).
    const dailyMap = new Map<string, { salesCents: number; orders: number }>();
    paidOrders.forEach((order) => {
      const dateKey = order.createdAt.toISOString().slice(0, 10);
      const existing = dailyMap.get(dateKey) || { salesCents: 0, orders: 0 };
      existing.salesCents += decimalToCents(order.finalAmount);
      existing.orders += 1;
      dailyMap.set(dateKey, existing);
    });

    const dailySales = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        sales: centsToCurrency(data.salesCents),
        orders: data.orders,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalSales,
      totalOrders,
      averageOrderValue,
      totalDiscount,
      paymentMethodBreakdown,
      dailySales,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  /**
   * Period-over-period comparison — the current window vs the immediately
   * preceding window of equal length (last-7-days vs the 7 days before, this
   * month vs last month, etc.). Returns each headline metric with its absolute
   * change and % change so trends are visible, not just point-in-time totals.
   */
  async getSalesComparison(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const spanMs = dateRange.end.getTime() - dateRange.start.getTime();
    const prevStart = new Date(dateRange.start.getTime() - spanMs);
    const prevEnd = new Date(dateRange.start.getTime());

    const [cur, prev, curCogs, prevCogs] = await Promise.all([
      this.getSalesSummary(tenantId, dateRange.start, dateRange.end, branchId),
      this.getSalesSummary(tenantId, prevStart, prevEnd, branchId),
      this.getCogsReport(tenantId, dateRange.start, dateRange.end, branchId),
      this.getCogsReport(tenantId, prevStart, prevEnd, branchId),
    ]);

    const pctChange = (c: number, p: number) =>
      p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null;
    const metric = (name: string, c: number, p: number) => ({
      metric: name,
      current: c,
      previous: p,
      change: Math.round((c - p) * 100) / 100,
      changePct: pctChange(c, p),
    });

    return {
      current: { startDate: dateRange.start, endDate: dateRange.end },
      previous: { startDate: prevStart, endDate: prevEnd },
      metrics: [
        metric("totalSales", cur.totalSales, prev.totalSales),
        metric("totalOrders", cur.totalOrders, prev.totalOrders),
        metric(
          "averageOrderValue",
          cur.averageOrderValue,
          prev.averageOrderValue,
        ),
        metric("cogs", curCogs.cogs, prevCogs.cogs),
        metric("grossProfit", curCogs.grossProfit, prevCogs.grossProfit),
      ],
      foodCostPct: {
        current: curCogs.foodCostPct,
        previous: prevCogs.foodCostPct,
      },
    };
  }

  /** Daily sales breakdown as a CSV string for accountant/spreadsheet export. */
  async getSalesSummaryCsv(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ): Promise<string> {
    const summary = await this.getSalesSummary(
      tenantId,
      startDate,
      endDate,
      branchId,
    );
    return toCsv(
      ["date", "orders", "sales"],
      summary.dailySales.map((d) => [d.date, d.orders, d.sales]),
    );
  }

  /**
   * Cost of Goods Sold + food-cost % for the window — the KPI a restaurateur
   * watches most. COGS is read straight from the ingredient-movement ledger:
   * every order deduction already recorded its FIFO-weighted costPerUnit
   * (stock-deduction.service.ts), so COGS is the net cost of ORDER_DEDUCTION
   * less ORDER_REVERSAL. `quantity` is negative for consumption, so
   * SUM(quantity * costPerUnit) is negative and COGS negates it. WASTE cost is
   * surfaced alongside as a separate line (shrinkage, not COGS). The
   * product-of-two-columns sum can't be expressed via Prisma groupBy, so it is
   * a single parameterized aggregate query. Un-costed movements (null
   * costPerUnit) contribute nothing rather than understating as zero.
   */
  async getCogsReport(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const branchScope = branchId ? { branchId } : {};

    const sales = await this.prisma.order.aggregate({
      where: {
        tenantId,
        ...branchScope,
        status: OrderStatus.PAID,
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
      _sum: { finalAmount: true },
      _count: true,
    });
    const totalSalesCents = decimalToCents(sales._sum.finalAmount);

    const branchFilter = branchId
      ? Prisma.sql`AND "branchId" = ${branchId}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { cogs_net: unknown; waste_net: unknown }[]
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN type IN ('ORDER_DEDUCTION','ORDER_REVERSAL')
          THEN quantity * "costPerUnit" END), 0) AS cogs_net,
        COALESCE(SUM(CASE WHEN type = 'WASTE'
          THEN quantity * "costPerUnit" END), 0) AS waste_net
      FROM ingredient_movements
      WHERE "tenantId" = ${tenantId} ${branchFilter}
        AND "createdAt" >= ${dateRange.start}
        AND "createdAt" <= ${dateRange.end}
    `);

    const cogsCents = decimalToCents(
      new Prisma.Decimal((rows[0]?.cogs_net ?? 0) as any).neg(),
    );
    const wasteCostCents = decimalToCents(
      new Prisma.Decimal((rows[0]?.waste_net ?? 0) as any).neg(),
    );
    const grossProfitCents = totalSalesCents - cogsCents;

    const pct = (part: number) =>
      totalSalesCents > 0
        ? Math.round((part / totalSalesCents) * 1000) / 10
        : null;

    return {
      totalSales: centsToCurrency(totalSalesCents),
      totalOrders: sales._count,
      cogs: centsToCurrency(cogsCents),
      wasteCost: centsToCurrency(wasteCostCents),
      grossProfit: centsToCurrency(grossProfitCents),
      foodCostPct: pct(cogsCents),
      wasteCostPct: pct(wasteCostCents),
      grossMarginPct: pct(grossProfitCents),
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  /**
   * Menu engineering — classify each sold product into the classic
   * profitability × popularity quadrant (Star / Plow-horse / Puzzle / Dog) plus
   * per-item contribution margin. Cost basis is Product.costPrice (recipe
   * products can sync their plate cost into costPrice). Popularity is "high"
   * when a product's units-sold is at least 70% of the average (the classic
   * menu-mix rule); profitability is "high" when unit margin ≥ the average unit
   * margin. Products without a cost basis are surfaced separately (uncosted) and
   * excluded from the averages so they don't skew the quadrant.
   */
  async getMenuEngineering(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const branchScope = branchId ? { branchId } : {};

    const sold = await this.prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        order: {
          tenantId,
          ...branchScope,
          status: OrderStatus.PAID,
          createdAt: { gte: dateRange.start, lte: dateRange.end },
        },
      },
      _sum: { quantity: true, subtotal: true },
    });

    const productIds = sold.map((s) => s.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId },
      select: {
        id: true,
        name: true,
        price: true,
        costPrice: true,
        category: { select: { name: true } },
      },
    });
    const pMap = new Map(products.map((p) => [p.id, p]));

    const rows = sold.map((s) => {
      const p = pMap.get(s.productId);
      const qty = Number(s._sum.quantity ?? 0);
      const revenueCents = decimalToCents(s._sum.subtotal);
      const price = p ? new Prisma.Decimal(p.price) : new Prisma.Decimal(0);
      const hasCost = !!p && p.costPrice != null;
      const cost = hasCost
        ? new Prisma.Decimal(p!.costPrice as any)
        : null;
      const unitMarginCents = cost
        ? decimalToCents(price.sub(cost))
        : null;
      return {
        productId: s.productId,
        productName: p?.name ?? "Unknown",
        categoryName: p?.category?.name ?? null,
        unitsSold: qty,
        revenue: centsToCurrency(revenueCents),
        unitPrice: centsToCurrency(decimalToCents(price)),
        unitCost: cost ? centsToCurrency(decimalToCents(cost)) : null,
        unitMargin:
          unitMarginCents != null ? centsToCurrency(unitMarginCents) : null,
        totalContribution:
          unitMarginCents != null
            ? centsToCurrency(unitMarginCents * qty)
            : null,
        _unitMarginCents: unitMarginCents,
        hasCost,
      };
    });

    const costed = rows.filter((r) => r.hasCost);
    const uncosted = rows
      .filter((r) => !r.hasCost)
      .map(({ _unitMarginCents, hasCost, ...rest }) => rest);

    const avgUnits =
      costed.length > 0
        ? costed.reduce((s, r) => s + r.unitsSold, 0) / costed.length
        : 0;
    const avgUnitMarginCents =
      costed.length > 0
        ? costed.reduce((s, r) => s + (r._unitMarginCents ?? 0), 0) /
          costed.length
        : 0;
    // Classic menu-engineering popularity rule: "high" ≥ 70% of average mix.
    const POPULARITY_FACTOR = 0.7;
    const popularityThreshold = avgUnits * POPULARITY_FACTOR;

    const classify = (highPop: boolean, highMargin: boolean) =>
      highPop && highMargin
        ? "STAR"
        : highPop && !highMargin
          ? "PLOWHORSE"
          : !highPop && highMargin
            ? "PUZZLE"
            : "DOG";

    const items = costed
      .map((r) => {
        const highPop = r.unitsSold >= popularityThreshold;
        const highMargin = (r._unitMarginCents ?? 0) >= avgUnitMarginCents;
        const { _unitMarginCents, hasCost, ...rest } = r;
        return { ...rest, classification: classify(highPop, highMargin) };
      })
      .sort((a, b) => (b.totalContribution ?? 0) - (a.totalContribution ?? 0));

    const counts = items.reduce(
      (acc, i) => {
        acc[i.classification] = (acc[i.classification] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      items,
      uncosted,
      averages: {
        avgUnitsSold: Math.round(avgUnits * 100) / 100,
        avgUnitMargin: centsToCurrency(Math.round(avgUnitMarginCents)),
        popularityThreshold: Math.round(popularityThreshold * 100) / 100,
      },
      counts: {
        STAR: counts.STAR ?? 0,
        PLOWHORSE: counts.PLOWHORSE ?? 0,
        PUZZLE: counts.PUZZLE ?? 0,
        DOG: counts.DOG ?? 0,
        uncosted: uncosted.length,
      },
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  /**
   * Tips report — totals + per-tender breakdown of recorded tips over the
   * window. Tips are the Payment.tipAmount recorded separately from the goods
   * amount, so this never double-counts sales. Feeds payroll / tip-out.
   */
  async getTipsReport(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const branchScope = branchId ? { branchId } : {};

    const byMethod = await this.prisma.payment.groupBy({
      by: ["method"],
      where: {
        tenantId,
        ...branchScope,
        status: "COMPLETED",
        tipAmount: { not: null },
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
      _sum: { tipAmount: true },
      _count: true,
    });

    const totalCents = byMethod.reduce(
      (s, m) => s + decimalToCents(m._sum.tipAmount),
      0,
    );

    return {
      totalTips: centsToCurrency(totalCents),
      tipCount: byMethod.reduce((s, m) => s + m._count, 0),
      byMethod: byMethod
        .map((m) => ({
          method: m.method,
          tips: centsToCurrency(decimalToCents(m._sum.tipAmount)),
          count: m._count,
        }))
        .sort((a, b) => b.tips - a.tips),
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  async getTopProducts(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    limit: number = 10,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const branchScope = branchId ? { branchId } : {};

    // Get top selling products
    const topProducts = await this.prisma.orderItem.groupBy({
      by: ["productId"],
      where: {
        order: {
          tenantId,
          ...branchScope,
          status: OrderStatus.PAID,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
      },
      _sum: {
        quantity: true,
        subtotal: true,
      },
      orderBy: {
        _sum: {
          subtotal: "desc",
        },
      },
      take: safeLimit,
    });

    // Fetch product details — tenant-scoped so a stale OrderItem referencing
    // a cross-tenant product (data-import edge case) cannot leak.
    const productIds = topProducts.map((item) => item.productId);
    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds },
        tenantId,
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });

    // Map products with sales data
    const productsMap = new Map(products.map((p) => [p.id, p]));
    const result = topProducts.map((item) => {
      const product = productsMap.get(item.productId);
      return {
        productId: item.productId,
        productName: product?.name || "Unknown Product",
        quantitySold: item._sum.quantity || 0,
        revenue: Number(item._sum.subtotal || 0),
        categoryName: product?.category.name,
      };
    });

    return {
      products: result,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  async getPaymentMethodBreakdown(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const branchScope = branchId ? { branchId } : {};

    const paymentBreakdown = await this.prisma.payment.groupBy({
      by: ["method"],
      where: {
        order: {
          tenantId,
          ...branchScope,
          status: OrderStatus.PAID,
          createdAt: {
            gte: dateRange.start,
            lte: dateRange.end,
          },
        },
        status: "COMPLETED",
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    const breakdown = paymentBreakdown.map((pm) => ({
      method: pm.method,
      totalAmount: Number(pm._sum.amount || 0),
      count: pm._count,
    }));

    return {
      breakdown,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  async getOrdersByHour(tenantId: string, date?: Date, branchId?: string) {
    // Day boundaries and the hour-of-day grouping below must use the
    // tenant's timezone, not the server pod's. Otherwise an Istanbul
    // tenant on a UTC pod loses the 21:00-23:59 hour of orders to "the
    // next day" and sees peaks shifted by 3 slots in the chart.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const tz = tenant?.timezone || "UTC";
    const anchor = date ?? new Date();
    const targetDate = getTenantMidnight(anchor, tz);
    const endDate = getTenantMidnight(
      new Date(anchor.getTime() + 24 * 60 * 60 * 1000),
      tz,
    );
    const branchScope = branchId ? { branchId } : {};

    const orders = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...branchScope,
        status: OrderStatus.PAID,
        createdAt: {
          gte: targetDate,
          lt: endDate,
        },
      },
      select: {
        createdAt: true,
        finalAmount: true,
      },
    });

    // Group by hour. Accumulate in integer cents so the long tail of
    // restaurant orders doesn't pollute the chart with IEEE-754 dust.
    const hourlyData = new Array(24).fill(0).map(() => ({
      orderCount: 0,
      totalSalesCents: 0,
    }));

    // `Intl.DateTimeFormat` resolves the hour-of-day in the tenant tz
    // for each order; cheaper than spinning up a TZ-aware lib and still
    // correct across DST transitions because Intl handles them.
    const hourFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    });
    orders.forEach((order) => {
      const hourStr = hourFmt.format(order.createdAt);
      const hour = parseInt(hourStr, 10) % 24;
      hourlyData[hour].orderCount++;
      hourlyData[hour].totalSalesCents += decimalToCents(order.finalAmount);
    });

    return {
      date: targetDate,
      hourlyData: hourlyData.map((data, hour) => ({
        hour,
        orderCount: data.orderCount,
        totalSales: centsToCurrency(data.totalSalesCents),
      })),
    };
  }

  /**
   * Get customer analytics report
   */
  async getCustomerAnalytics(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const branchScope = branchId ? { branchId } : {};

    // Get customer tier distribution
    const tierDistribution = await this.prisma.customer.groupBy({
      by: ["loyaltyTier"],
      where: { tenantId },
      _count: true,
    });

    // Get new customers in date range
    const newCustomersCount = await this.prisma.customer.count({
      where: {
        tenantId,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
    });

    // Get returning customers (orders in date range from customers created before date range)
    const returningCustomersOrders = await this.prisma.order.findMany({
      where: {
        tenantId,
        ...branchScope,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        customer: {
          createdAt: {
            lt: dateRange.start,
          },
        },
      },
      distinct: ["customerId"],
      select: {
        customerId: true,
      },
    });

    // Get total customers
    const totalCustomers = await this.prisma.customer.count({
      where: { tenantId },
    });

    // Top customers by spending
    const topCustomers = await this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { totalSpent: "desc" },
      take: 10,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        totalOrders: true,
        totalSpent: true,
        loyaltyTier: true,
        loyaltyPoints: true,
        lastVisit: true,
      },
    });

    // Average lifetime value
    const avgLTV = await this.prisma.customer.aggregate({
      where: { tenantId },
      _avg: { totalSpent: true },
    });

    // Total loyalty points issued
    const totalLoyaltyPoints = await this.prisma.customer.aggregate({
      where: { tenantId },
      _sum: { loyaltyPoints: true },
    });

    return {
      tierDistribution: tierDistribution.map((t) => ({
        tier: t.loyaltyTier,
        count: t._count,
      })),
      totalCustomers,
      newCustomers: newCustomersCount,
      returningCustomers: returningCustomersOrders.length,
      topCustomers: topCustomers.map((c) => ({
        ...c,
        totalSpent: Number(c.totalSpent),
      })),
      averageLifetimeValue: Number(avgLTV._avg.totalSpent || 0),
      totalLoyaltyPoints: totalLoyaltyPoints._sum.loyaltyPoints || 0,
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }

  /**
   * Get inventory report
   */
  async getInventoryReport(tenantId: string) {
    // Get all tracked products
    const products = await this.prisma.product.findMany({
      where: {
        tenantId,
        stockTracked: true,
      },
      include: {
        category: {
          select: { name: true },
        },
      },
      orderBy: { currentStock: "asc" },
    });

    // Low stock threshold
    const LOW_STOCK_THRESHOLD = 10;

    // v2.8.98 — currentStock is Prisma.Decimal; comparisons go through
    // .gt/.lt rather than the JS operators.
    const stockGt = (p: { currentStock: any }, n: number) =>
      new Prisma.Decimal(p.currentStock).gt(n);
    const stockLt = (p: { currentStock: any }, n: number) =>
      new Prisma.Decimal(p.currentStock).lt(n);
    const stockLte = (p: { currentStock: any }, n: number) =>
      new Prisma.Decimal(p.currentStock).lte(n);

    // Get low stock items
    const lowStockItems = products.filter(
      (p) => stockGt(p, 0) && stockLt(p, LOW_STOCK_THRESHOLD),
    );

    // Get out of stock items
    const outOfStockItems = products.filter((p) => stockLte(p, 0));

    // Value inventory at COST (costPrice), NOT retail `price` — an asset is
    // carried at cost; valuing at retail overstates the inventory figure.
    // Products with no cost basis (costPrice null) contribute 0 and are counted
    // so the gap is visible rather than silently distorting the total.
    // Accumulate in integer cents to avoid Decimal→Number drift over many rows.
    let itemsWithoutCost = 0;
    const totalStockValueCents = products.reduce((sum, p) => {
      if (p.costPrice == null) itemsWithoutCost += 1;
      return (
        sum +
        new Prisma.Decimal(p.currentStock).toNumber() *
          decimalToCents(p.costPrice ?? 0)
      );
    }, 0);
    const totalStockValue = centsToCurrency(totalStockValueCents);

    // Get recent stock movements
    const recentMovements = await this.prisma.stockMovement.findMany({
      where: { tenantId },
      take: 20,
      orderBy: { createdAt: "desc" },
      include: {
        product: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    });

    return {
      totalTrackedProducts: products.length,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      totalStockValue,
      // Signals the total is at cost and how many products lack a cost basis.
      valuationBasis: "cost" as const,
      itemsWithoutCost,
      lowStockItems: lowStockItems.map((p) => ({
        productId: p.id,
        productName: p.name,
        categoryName: p.category?.name,
        currentStock: new Prisma.Decimal(p.currentStock).toNumber(),
        price: Number(p.price),
      })),
      outOfStockItems: outOfStockItems.map((p) => ({
        productId: p.id,
        productName: p.name,
        categoryName: p.category?.name,
      })),
      stockLevels: products.map((p) => ({
        productId: p.id,
        productName: p.name,
        categoryName: p.category?.name,
        currentStock: new Prisma.Decimal(p.currentStock).toNumber(),
        price: Number(p.price),
        costPrice: p.costPrice != null ? Number(p.costPrice) : null,
        // stockValue is at COST (costPrice), consistent with totalStockValue.
        stockValue: centsToCurrency(
          new Prisma.Decimal(p.currentStock).toNumber() *
            decimalToCents(p.costPrice ?? 0),
        ),
        isLowStock: stockGt(p, 0) && stockLt(p, LOW_STOCK_THRESHOLD),
        isOutOfStock: stockLte(p, 0),
      })),
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        productName: m.product.name,
        performedBy: `${m.user.firstName} ${m.user.lastName}`,
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Get staff performance report
   */
  async getStaffPerformance(
    tenantId: string,
    startDate?: Date,
    endDate?: Date,
    branchId?: string,
  ) {
    const dateRange = await this.getDateRange(tenantId, startDate, endDate);
    const branchScope = branchId ? { branchId } : {};

    // Get orders grouped by staff
    const staffOrders = await this.prisma.order.groupBy({
      by: ["userId"],
      where: {
        tenantId,
        ...branchScope,
        status: OrderStatus.PAID,
        createdAt: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
        userId: { not: null },
      },
      _sum: { finalAmount: true },
      _count: true,
    });

    // Fetch user details — tenant-scoped for the same defense-in-depth reason
    // as product lookups above.
    const userIds = staffOrders
      .map((s) => s.userId)
      .filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, tenantId },
      select: { id: true, firstName: true, lastName: true, role: true },
    });

    const usersMap = new Map(users.map((u) => [u.id, u]));

    // Calculate staff performance metrics
    const staffPerformance = staffOrders
      .map((s) => {
        const user = usersMap.get(s.userId as string);
        const totalSales = Number(s._sum.finalAmount || 0);
        return {
          userId: s.userId,
          staffName: user ? `${user.firstName} ${user.lastName}` : "Unknown",
          role: user?.role || "Unknown",
          totalOrders: s._count,
          totalSales,
          averageOrderValue: s._count > 0 ? totalSales / s._count : 0,
        };
      })
      .sort((a, b) => b.totalSales - a.totalSales);

    // Calculate totals
    const totalOrders = staffPerformance.reduce(
      (sum, s) => sum + s.totalOrders,
      0,
    );
    const totalSales = staffPerformance.reduce(
      (sum, s) => sum + s.totalSales,
      0,
    );

    return {
      staffPerformance,
      summary: {
        totalStaff: staffPerformance.length,
        totalOrders,
        totalSales,
        averageOrdersPerStaff:
          staffPerformance.length > 0
            ? totalOrders / staffPerformance.length
            : 0,
        averageSalesPerStaff:
          staffPerformance.length > 0
            ? totalSales / staffPerformance.length
            : 0,
      },
      startDate: dateRange.start,
      endDate: dateRange.end,
    };
  }
}
