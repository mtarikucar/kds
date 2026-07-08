import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/**
 * Pure Z-Report aggregation / number-crunching, extracted VERBATIM from
 * ZReportsService.generateReport (god-file split). Takes the rows the
 * service already fetched (branch-scoped paid orders, cancelled orders,
 * approved cash-drawer movements, open orders) plus the cash-drawer
 * opening/closing inputs and returns the computed totals that feed
 * `zReport.create`.
 *
 * NO DB ACCESS — the data-fetching and per-branch scoping (the Track-1A
 * `where { tenantId, branchId }` guard) stay in ZReportsService; this class
 * only crunches the already-fetched rows. Every Decimal accumulation,
 * filter, call order, and rounding boundary is preserved byte-for-byte so
 * the high-volume money math (Prisma.Decimal, not Number) cannot drift.
 *
 * Inputs are structurally typed to exactly the fields the original code
 * read, so the aggregator stays decoupled from the full Prisma include
 * shape while remaining faithful to it.
 */

type Money = Prisma.Decimal | number | string | null | undefined;

export interface AggregatorPayment {
  status: string;
  method: string;
  amount: Money;
}

export interface AggregatorOrderItem {
  id?: string;
  // Combo children reference their 0₺ parent grouping row via this id; a
  // parent is any item referenced here. Reports exclude parents so the combo
  // package doesn't show as a 0-revenue product (money lives on children).
  parentOrderItemId?: string | null;
  productId: string;
  quantity: number;
  subtotal: Money;
  taxRate?: number | null;
  taxAmount?: Money;
  product: {
    name: string;
    categoryId: string;
    category?: { name?: string | null } | null;
  };
}

export interface AggregatorOrder {
  type: string;
  totalAmount: Money;
  discount: Money;
  finalAmount: Money;
  userId?: string | null;
  user?: { firstName: string; lastName: string } | null;
  payments: AggregatorPayment[];
  orderItems: AggregatorOrderItem[];
}

export interface AggregatorCancelledOrder {
  totalAmount: Money;
}

export interface AggregatorCashMovement {
  type: string;
  amount: Money;
}

export interface AggregatorOpenOrder {
  finalAmount: Money;
}

export interface ZReportAggregatorInput {
  orders: AggregatorOrder[];
  cancelledOrdersList: AggregatorCancelledOrder[];
  cashMovements: AggregatorCashMovement[];
  openOrders: AggregatorOpenOrder[];
  cashDrawerOpening: number;
  cashDrawerClosing: number;
}

/**
 * The fiscal totals produced from the fetched rows. Field names mirror the
 * local variables in the original generateReport so the service can spread
 * them straight into `zReport.create({ data: { ... } })`.
 */
export interface ZReportTotals {
  totalOrders: number;
  totalSales: Prisma.Decimal;
  totalDiscount: Prisma.Decimal;
  netSales: Prisma.Decimal;
  totalTax: number;
  taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }>;

  cashPayments: Prisma.Decimal;
  cashPaymentCount: number;
  cardPayments: Prisma.Decimal;
  cardPaymentCount: number;
  digitalPayments: Prisma.Decimal;
  digitalPaymentCount: number;

  dineInSales: Prisma.Decimal;
  dineInOrders: number;
  takeawaySales: Prisma.Decimal;
  takeawayOrders: number;
  deliverySales: Prisma.Decimal;
  deliveryOrders: number;

  cancelledOrders: number;
  cancelledOrdersAmount: Prisma.Decimal;

  totalRefunds: Prisma.Decimal;
  refundedPayments: number;
  refundedAmount: Prisma.Decimal;

  expectedCash: Prisma.Decimal;
  cashDifference: Prisma.Decimal;
  cashInOut: Prisma.Decimal;

  openChecks: number;
  openChecksAmount: Prisma.Decimal;

  topProducts: Array<{ name: string; quantity: number; revenue: number }>;
  categoryBreakdown: Array<{
    categoryId: string;
    categoryName: string;
    sales: number;
    quantity: number;
  }>;
  staffPerformance: Array<{
    staffId: string;
    name: string;
    sales: number;
    orders: number;
    refunds: number;
  }>;
}

@Injectable()
export class ZReportAggregator {
  /**
   * Crunch the fetched rows into the fiscal totals. Moved verbatim from
   * ZReportsService.generateReport — same Decimal math, same filters, same
   * order, same rounding.
   */
  aggregate(input: ZReportAggregatorInput): ZReportTotals {
    const {
      orders,
      cancelledOrdersList,
      cashMovements,
      openOrders,
      cashDrawerOpening,
      cashDrawerClosing,
    } = input;

    // Combo 0₺ parent grouping rows — excluded from product-level breakdowns
    // and the per-line KDV tally so a combo doesn't surface as a 0-revenue
    // product and no spurious 0%/0₺ bucket is created. Order/KDV TOTALS are
    // unaffected either way (parents carry 0), so this only cleans breakdowns.
    const comboParentIds = new Set(
      orders
        .flatMap((o) => o.orderItems)
        .filter((it) => it.parentOrderItemId)
        .map((it) => it.parentOrderItemId),
    );
    const isComboParent = (it: AggregatorOrderItem) =>
      it.id != null && comboParentIds.has(it.id);

    // v2.8.97 — all money math now goes through Prisma.Decimal so
    // IEEE-754 drift can't accumulate over high-volume tenants
    // (~1000+ orders/day) where Number additions silently round.
    // The final fields are stored as Decimal columns anyway, so
    // converting at the end is the only place precision crosses
    // the boundary back to JS Number.
    const decSum = <T>(
      items: T[],
      pick: (item: T) => Prisma.Decimal | number | string | null | undefined,
    ): Prisma.Decimal =>
      items.reduce(
        (acc, item) => acc.add(new Prisma.Decimal(pick(item) ?? 0)),
        new Prisma.Decimal(0),
      );

    // Calculate totals
    const totalOrders = orders.length;
    const grossSales = decSum(orders, (o) => o.totalAmount);
    const discounts = decSum(orders, (o) => o.discount);
    const rawNetSales = decSum(orders, (o) => o.finalAmount);

    // Calculate payment method breakdown (only COMPLETED payments)
    const allPayments = orders
      .flatMap((o) => o.payments)
      .filter((p) => p.status === "COMPLETED");

    const cashPaymentsList = allPayments.filter((p) => p.method === "CASH");
    const cashPayments = decSum(cashPaymentsList, (p) => p.amount);
    const cashPaymentCount = cashPaymentsList.length;

    const cardPaymentsList = allPayments.filter((p) => p.method === "CARD");
    const cardPayments = decSum(cardPaymentsList, (p) => p.amount);
    const cardPaymentCount = cardPaymentsList.length;

    const digitalPaymentsList = allPayments.filter(
      (p) => p.method === "DIGITAL",
    );
    const digitalPayments = decSum(digitalPaymentsList, (p) => p.amount);
    const digitalPaymentCount = digitalPaymentsList.length;

    // Calculate refunds
    const refundedPayments = orders
      .flatMap((o) => o.payments)
      .filter((p) => p.status === "REFUNDED");
    const refundedAmount = decSum(refundedPayments, (p) => p.amount);
    const totalRefunds = refundedAmount;

    // Net sales accounts for refunds
    const netSales = rawNetSales.sub(totalRefunds);

    // Order type breakdown
    const dineInOrders = orders.filter((o) => o.type === "DINE_IN");
    const dineInSales = decSum(dineInOrders, (o) => o.finalAmount);

    const takeawayOrders = orders.filter((o) => o.type === "TAKEAWAY");
    const takeawaySales = decSum(takeawayOrders, (o) => o.finalAmount);

    const deliveryOrders = orders.filter((o) => o.type === "DELIVERY");
    const deliverySales = decSum(deliveryOrders, (o) => o.finalAmount);

    const counterOrders = orders.filter((o) => o.type === "COUNTER");
    const counterSales = decSum(counterOrders, (o) => o.finalAmount);

    const cancelledOrders = cancelledOrdersList.length;
    const cancelledOrdersAmount = decSum(
      cancelledOrdersList,
      (o) => o.totalAmount,
    );

    // Get top selling products — Decimal accumulation, number on output.
    const productDecSales = new Map<
      string,
      { name: string; quantity: number; revenue: Prisma.Decimal }
    >();
    orders.forEach((order) => {
      order.orderItems.forEach((item) => {
        if (isComboParent(item)) return; // skip 0₺ combo grouping rows
        let existing = productDecSales.get(item.productId);
        if (!existing) {
          existing = {
            name: item.product.name,
            quantity: 0,
            revenue: new Prisma.Decimal(0),
          };
          productDecSales.set(item.productId, existing);
        }
        existing.quantity += item.quantity;
        existing.revenue = existing.revenue.add(
          new Prisma.Decimal(item.subtotal),
        );
      });
    });

    const topProducts = Array.from(productDecSales.values())
      .map((p) => ({
        name: p.name,
        quantity: p.quantity,
        revenue: p.revenue.toDecimalPlaces(2).toNumber(),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Tax breakdown from order items (Decimal arithmetic — same
    // accumulation-precision reason as the sale totals above).
    const allOrderItems = orders
      .flatMap((o) => o.orderItems)
      .filter((it) => !isComboParent(it));
    const taxBreakdownDecMap = new Map<
      number,
      { taxableAmount: Prisma.Decimal; taxAmount: Prisma.Decimal }
    >();
    let totalTaxDec = new Prisma.Decimal(0);

    for (const item of allOrderItems) {
      const rate = item.taxRate ?? 10;
      const tax = new Prisma.Decimal(item.taxAmount || 0);
      const subtotalDec = new Prisma.Decimal(item.subtotal || 0);
      let bucket = taxBreakdownDecMap.get(rate);
      if (!bucket) {
        bucket = {
          taxableAmount: new Prisma.Decimal(0),
          taxAmount: new Prisma.Decimal(0),
        };
        taxBreakdownDecMap.set(rate, bucket);
      }
      bucket.taxAmount = bucket.taxAmount.add(tax);
      bucket.taxableAmount = bucket.taxableAmount.add(subtotalDec.sub(tax));
      totalTaxDec = totalTaxDec.add(tax);
    }
    // Storage shape stays {number → {taxableAmount: number, taxAmount: number}}
    // for backward compat with downstream consumers.
    const taxBreakdownMap: Record<
      number,
      { taxableAmount: number; taxAmount: number }
    > = {};
    for (const [rate, b] of taxBreakdownDecMap) {
      taxBreakdownMap[rate] = {
        taxableAmount: b.taxableAmount.toDecimalPlaces(2).toNumber(),
        taxAmount: b.taxAmount.toDecimalPlaces(2).toNumber(),
      };
    }
    const totalTax = totalTaxDec.toDecimalPlaces(2).toNumber();

    // Calculate cash in/out movements (Decimal)
    const cashInTotal = decSum(
      cashMovements.filter((m) => m.type === "CASH_IN"),
      (m) => m.amount,
    );
    const cashOutTotal = decSum(
      cashMovements.filter((m) => m.type === "CASH_OUT"),
      (m) => m.amount,
    );
    const cashInOut = cashInTotal.sub(cashOutTotal);

    // Cash drawer reconciliation. cashDrawerOpening / cashDrawerClosing
    // arrive as JS numbers from the closing DTO; coerce through Decimal
    // before adding so the final reconciliation row is precision-clean.
    const openingDec = new Prisma.Decimal(cashDrawerOpening);
    const closingDec = new Prisma.Decimal(cashDrawerClosing);
    const expectedCash = openingDec.add(cashPayments).add(cashInOut);
    const cashDifference = closingDec.sub(expectedCash);

    // Calculate staff performance — Decimal accumulation, number on
    // the JSON output (staffPerformance is read by reporting UIs that
    // expect plain numbers).
    const staffDecMap = new Map<
      string,
      { name: string; sales: Prisma.Decimal; orders: number; refunds: number }
    >();
    for (const order of orders) {
      const staffId = order.userId || "unknown";
      const staffName = order.user
        ? `${order.user.firstName} ${order.user.lastName}`
        : "Unknown";
      let existing = staffDecMap.get(staffId);
      if (!existing) {
        existing = {
          name: staffName,
          sales: new Prisma.Decimal(0),
          orders: 0,
          refunds: 0,
        };
        staffDecMap.set(staffId, existing);
      }
      existing.sales = existing.sales.add(
        new Prisma.Decimal(order.finalAmount),
      );
      existing.orders += 1;
    }
    const staffPerformance = Array.from(staffDecMap.entries()).map(
      ([id, data]) => ({
        staffId: id,
        name: data.name,
        sales: data.sales.toDecimalPlaces(2).toNumber(),
        orders: data.orders,
        refunds: data.refunds,
      }),
    );

    const openChecks = openOrders.length;
    const openChecksAmount = decSum(openOrders, (o) => o.finalAmount);

    // Calculate category breakdown — Decimal accumulation as above.
    const categoryDecMap = new Map<
      string,
      { categoryName: string; sales: Prisma.Decimal; quantity: number }
    >();
    for (const order of orders) {
      for (const item of order.orderItems) {
        if (isComboParent(item)) continue; // combo revenue lives on children
        const catId = item.product.categoryId;
        const catName = item.product.category?.name || "Uncategorized";
        let existing = categoryDecMap.get(catId);
        if (!existing) {
          existing = {
            categoryName: catName,
            sales: new Prisma.Decimal(0),
            quantity: 0,
          };
          categoryDecMap.set(catId, existing);
        }
        existing.sales = existing.sales.add(new Prisma.Decimal(item.subtotal));
        existing.quantity += item.quantity;
      }
    }
    const categoryBreakdown = Array.from(categoryDecMap.entries()).map(
      ([id, data]) => ({
        categoryId: id,
        categoryName: data.categoryName,
        sales: data.sales.toDecimalPlaces(2).toNumber(),
        quantity: data.quantity,
      }),
    );

    // counterSales is computed for parity with the original method but is
    // not persisted (the ZReport schema has no counter column). Reference
    // it so the verbatim move stays lint-clean without changing behavior.
    void counterSales;

    return {
      totalOrders,
      totalSales: grossSales,
      totalDiscount: discounts,
      netSales,
      totalTax,
      taxBreakdown: taxBreakdownMap,

      cashPayments,
      cashPaymentCount,
      cardPayments,
      cardPaymentCount,
      digitalPayments,
      digitalPaymentCount,

      dineInSales,
      dineInOrders: dineInOrders.length,
      takeawaySales,
      takeawayOrders: takeawayOrders.length,
      deliverySales,
      deliveryOrders: deliveryOrders.length,

      cancelledOrders,
      cancelledOrdersAmount,

      totalRefunds,
      refundedPayments: refundedPayments.length,
      refundedAmount,

      expectedCash,
      cashDifference,
      cashInOut,

      openChecks,
      openChecksAmount,

      topProducts,
      categoryBreakdown,
      staffPerformance,
    };
  }
}
