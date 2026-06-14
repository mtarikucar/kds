import { Prisma } from "@prisma/client";
import {
  ZReportAggregator,
  ZReportAggregatorInput,
} from "./z-report-aggregator.service";

/**
 * Long-tail spec for the pure Z-Report aggregator (money math, no DB). The
 * load-bearing contracts: Decimal accumulation (no IEEE drift), only
 * COMPLETED payments count toward method breakdowns, REFUNDED payments
 * reduce net sales, order-type buckets split by `type`, cash
 * reconciliation = opening + cashPayments + (in-out), and top-products are
 * revenue-sorted + capped at 10.
 */
describe("ZReportAggregator.aggregate", () => {
  const agg = new ZReportAggregator();

  function makeOrder(over: Partial<any> = {}): any {
    return {
      type: "DINE_IN",
      totalAmount: 100,
      discount: 0,
      finalAmount: 100,
      userId: "u1",
      user: { firstName: "Ada", lastName: "Lovelace" },
      payments: [{ status: "COMPLETED", method: "CASH", amount: 100 }],
      orderItems: [
        {
          productId: "p1",
          quantity: 1,
          subtotal: 100,
          taxRate: 10,
          taxAmount: 9,
          product: {
            name: "Burger",
            categoryId: "c1",
            category: { name: "Mains" },
          },
        },
      ],
      ...over,
    };
  }

  function baseInput(over: Partial<ZReportAggregatorInput> = {}): ZReportAggregatorInput {
    return {
      orders: [],
      cancelledOrdersList: [],
      cashMovements: [],
      openOrders: [],
      cashDrawerOpening: 0,
      cashDrawerClosing: 0,
      ...over,
    };
  }

  it("sums gross sales, discounts and net sales as Decimals", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [
          makeOrder({ totalAmount: 100, discount: 10, finalAmount: 90 }),
          makeOrder({ totalAmount: 50, discount: 0, finalAmount: 50 }),
        ],
      }),
    );
    expect(r.totalOrders).toBe(2);
    expect(r.totalSales.toString()).toBe("150");
    expect(r.totalDiscount.toString()).toBe("10");
    // net = finalAmount sum (140) - refunds (0)
    expect(r.netSales.toString()).toBe("140");
  });

  it("counts only COMPLETED payments per method", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [
          makeOrder({
            payments: [
              { status: "COMPLETED", method: "CASH", amount: 40 },
              { status: "PENDING", method: "CASH", amount: 999 }, // ignored
              { status: "COMPLETED", method: "CARD", amount: 60 },
            ],
          }),
        ],
      }),
    );
    expect(r.cashPayments.toString()).toBe("40");
    expect(r.cashPaymentCount).toBe(1);
    expect(r.cardPayments.toString()).toBe("60");
    expect(r.cardPaymentCount).toBe(1);
  });

  it("subtracts REFUNDED payments from net sales", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [
          makeOrder({
            finalAmount: 100,
            payments: [{ status: "REFUNDED", method: "CARD", amount: 30 }],
          }),
        ],
      }),
    );
    expect(r.totalRefunds.toString()).toBe("30");
    expect(r.refundedPayments).toBe(1);
    // net = 100 - 30
    expect(r.netSales.toString()).toBe("70");
  });

  it("splits sales by order type", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [
          makeOrder({ type: "DINE_IN", finalAmount: 100 }),
          makeOrder({ type: "TAKEAWAY", finalAmount: 50 }),
          makeOrder({ type: "DELIVERY", finalAmount: 25 }),
        ],
      }),
    );
    expect(r.dineInOrders).toBe(1);
    expect(r.dineInSales.toString()).toBe("100");
    expect(r.takeawaySales.toString()).toBe("50");
    expect(r.deliverySales.toString()).toBe("25");
  });

  it("reconciles cash: expectedCash = opening + cashPayments + (in - out)", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [
          makeOrder({
            payments: [{ status: "COMPLETED", method: "CASH", amount: 200 }],
          }),
        ],
        cashMovements: [
          { type: "CASH_IN", amount: 50 },
          { type: "CASH_OUT", amount: 20 },
        ],
        cashDrawerOpening: 100,
        cashDrawerClosing: 340,
      }),
    );
    // expected = 100 + 200 + (50-20) = 330
    expect(r.expectedCash.toString()).toBe("330");
    expect(r.cashInOut.toString()).toBe("30");
    // difference = closing(340) - expected(330)
    expect(r.cashDifference.toString()).toBe("10");
  });

  it("aggregates + revenue-sorts top products and caps at 10", () => {
    const items = (id: string, name: string, sub: number) => ({
      productId: id,
      quantity: 1,
      subtotal: sub,
      taxRate: 10,
      taxAmount: 0,
      product: { name, categoryId: "c", category: { name: "X" } },
    });
    const orders = Array.from({ length: 12 }, (_, i) =>
      makeOrder({ orderItems: [items(`p${i}`, `P${i}`, i + 1)] }),
    );
    const r = agg.aggregate(baseInput({ orders }));
    expect(r.topProducts.length).toBe(10);
    // highest revenue (p11=12) first, descending
    expect(r.topProducts[0].revenue).toBe(12);
    expect(r.topProducts[0].revenue).toBeGreaterThanOrEqual(
      r.topProducts[1].revenue,
    );
  });

  it("buckets tax by rate and totals it", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [
          makeOrder({
            orderItems: [
              {
                productId: "p1",
                quantity: 1,
                subtotal: 100,
                taxRate: 10,
                taxAmount: 9,
                product: { name: "A", categoryId: "c", category: { name: "X" } },
              },
              {
                productId: "p2",
                quantity: 1,
                subtotal: 200,
                taxRate: 20,
                taxAmount: 33,
                product: { name: "B", categoryId: "c", category: { name: "X" } },
              },
            ],
          }),
        ],
      }),
    );
    expect(r.taxBreakdown[10].taxAmount).toBe(9);
    expect(r.taxBreakdown[20].taxAmount).toBe(33);
    expect(r.totalTax).toBe(42);
  });

  it("aggregates staff performance and category breakdown", () => {
    const r = agg.aggregate(
      baseInput({
        orders: [makeOrder({ userId: "u1", finalAmount: 100 })],
      }),
    );
    const staff = r.staffPerformance.find((s) => s.staffId === "u1");
    expect(staff).toMatchObject({ name: "Ada Lovelace", orders: 1, sales: 100 });
    const cat = r.categoryBreakdown.find((c) => c.categoryId === "c1");
    expect(cat).toMatchObject({ categoryName: "Mains", quantity: 1 });
  });

  it("counts cancelled and open checks with their amounts", () => {
    const r = agg.aggregate(
      baseInput({
        cancelledOrdersList: [{ totalAmount: 30 }, { totalAmount: 20 }],
        openOrders: [{ finalAmount: 15 }],
      }),
    );
    expect(r.cancelledOrders).toBe(2);
    expect(r.cancelledOrdersAmount.toString()).toBe("50");
    expect(r.openChecks).toBe(1);
    expect(r.openChecksAmount.toString()).toBe("15");
  });

  it("returns Prisma.Decimal instances for the persisted money fields", () => {
    const r = agg.aggregate(baseInput({ orders: [makeOrder()] }));
    expect(r.totalSales).toBeInstanceOf(Prisma.Decimal);
    expect(r.expectedCash).toBeInstanceOf(Prisma.Decimal);
  });
});
