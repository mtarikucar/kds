import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

/**
 * Task 8 (multi-country architecture): guards the Decimal(10, 2) -> Decimal(14, 2)
 * widening of every money column in the schema.
 *
 * Decimal(10, 2) tops out at 99,999,999.99. 1 USD is roughly 12,150 UZS, so
 * that ceiling is only ~8,230 USD once a tenant's currency is a low-unit-value
 * one — a restaurant turning over 8,000 USD/day produces a ZReport daily
 * total around 97M so'm, right at the old ceiling, and Customer.totalSpent
 * (a LIFETIME total) overflowed trivially for any loyal customer. Before the
 * widening migration (20260820130000_widen_money_decimal_precision) this
 * suite's insert assertion failed with Postgres error 22003 "numeric field
 * overflow"; it passes now that every money column is Decimal(14, 2).
 *
 * REAL-DB only, gated by DECIMAL_OVERFLOW_E2E_DB (an isolated throwaway
 * Postgres with the full migration history applied) so the normal mocked
 * suite — and CI's `npm run test:ci`, which has no live Postgres — is
 * unaffected. Run manually against a scratch DB, e.g.:
 *
 *   DECIMAL_OVERFLOW_E2E_DB=postgresql://user:pass@localhost:5432/scratch \
 *     npx jest src/common/country/decimal-overflow.spec.ts
 */
const RUN = !!process.env.DECIMAL_OVERFLOW_E2E_DB;
const d = RUN ? describe : describe.skip;

/**
 * Every (table, column) the widening migration touched. Kept in sync with
 * `prisma/migrations/20260820130000_widen_money_decimal_precision`: if a
 * future migration narrows one of these back down, or a new money column
 * gets added at Decimal(10, 2) instead of Decimal(14, 2), this list is the
 * thing to update alongside it.
 */
const WIDENED_COLUMNS: Array<[table: string, column: string]> = [
  ["users", "hourlyRate"],
  ["products", "price"],
  ["products", "costPrice"],
  ["products", "campaignPrice"],
  ["combo_group_items", "priceDelta"],
  ["modifiers", "priceAdjustment"],
  ["orders", "totalAmount"],
  ["orders", "discount"],
  ["orders", "finalAmount"],
  ["orders", "taxAmount"],
  ["order_items", "unitPrice"],
  ["order_items", "subtotal"],
  ["order_items", "modifierTotal"],
  ["order_items", "taxAmount"],
  ["order_items", "listUnitPrice"],
  ["order_item_modifiers", "priceAdjustment"],
  ["payments", "amount"],
  ["payments", "tipAmount"],
  ["order_item_payments", "amount"],
  ["pending_self_payments", "amount"],
  ["subscription_plans", "monthlyPrice"],
  ["subscription_plans", "yearlyPrice"],
  ["subscriptions", "amount"],
  ["subscription_payments", "amount"],
  ["invoices", "subtotal"],
  ["invoices", "tax"],
  ["invoices", "total"],
  ["customers", "totalSpent"],
  ["customers", "averageOrder"],
  ["loyalty_transactions", "orderAmount"],
  ["z_reports", "totalSales"],
  ["z_reports", "totalDiscount"],
  ["z_reports", "totalRefunds"],
  ["z_reports", "netSales"],
  ["z_reports", "totalTax"],
  ["z_reports", "dineInSales"],
  ["z_reports", "takeawaySales"],
  ["z_reports", "deliverySales"],
  ["z_reports", "cashPayments"],
  ["z_reports", "cardPayments"],
  ["z_reports", "digitalPayments"],
  ["z_reports", "openingCash"],
  ["z_reports", "expectedCash"],
  ["z_reports", "countedCash"],
  ["z_reports", "cashDifference"],
  ["z_reports", "cashInOut"],
  ["z_reports", "cancelledOrdersAmount"],
  ["z_reports", "refundedAmount"],
  ["z_reports", "openChecksAmount"],
  ["cash_drawer_movements", "amount"],
  ["cashier_sessions", "openingFloat"],
  ["cashier_sessions", "countedCash"],
  ["cashier_sessions", "expectedCash"],
  ["cashier_sessions", "overShort"],
  ["cashier_sessions", "cashSales"],
  ["cashier_sessions", "cashIn"],
  ["cashier_sessions", "cashOut"],
  ["table_analytics", "revenueGenerated"],
  ["table_analytics", "avgOrderValue"],
  ["purchase_order_template_items", "unitPrice"],
  ["lead_offers", "planMonthlyPrice"],
  ["lead_offers", "customPrice"],
  ["lead_offers", "discount"],
  ["commissions", "amount"],
  ["sales_invoices", "withholdingTaxAmount"],
  ["sales_invoices", "subtotal"],
  ["sales_invoices", "taxAmount"],
  ["sales_invoices", "totalAmount"],
  ["sales_invoices", "discount"],
  ["sales_invoice_items", "unitPrice"],
  ["sales_invoice_items", "taxAmount"],
  ["sales_invoice_items", "subtotal"],
  ["sales_invoice_items", "total"],
];

interface PrecisionRow {
  table_name: string;
  column_name: string;
  numeric_precision: number;
  numeric_scale: number;
}

d("Decimal(10, 2) overflow — money column widening", () => {
  // Constructed in beforeAll (NOT at collection time) so the default,
  // DECIMAL_OVERFLOW_E2E_DB-less `jest` run never builds a client with an
  // undefined url.
  let prisma: PrismaClient;
  const tenantId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DECIMAL_OVERFLOW_E2E_DB } },
    });
    await prisma.tenant.create({ data: { id: tenantId, name: "E2E" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  });

  it("stores every widened column at Decimal(14, 2) in the live catalog", async () => {
    const rows = await prisma.$queryRaw<PrecisionRow[]>`
      SELECT table_name, column_name, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `;
    const byKey = new Map(
      rows.map((r) => [`${r.table_name}.${r.column_name}`, r]),
    );

    for (const [table, column] of WIDENED_COLUMNS) {
      const row = byKey.get(`${table}.${column}`);
      expect(row).toBeDefined();
      expect([row!.numeric_precision, row!.numeric_scale]).toEqual([14, 2]);
    }
  });

  it("holds a 100,000,000 so'm lifetime total — the exact figure that overflowed Decimal(10, 2)", async () => {
    // 100,000,000.00 has 9 integer digits; Decimal(10, 2) allows at most 8
    // (precision 10 - scale 2), so this insert threw Postgres 22003 "numeric
    // field overflow" before the widening migration ran.
    const customer = await prisma.customer.create({
      data: {
        tenantId,
        name: "Sadık Müşteri",
        totalSpent: "100000000.00",
        averageOrder: "12345678.90",
      },
    });

    const reread = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.id },
    });
    // .toFixed(2) rather than .toString(): decimal.js's toString() trims
    // trailing zeros ("100000000.00" -> "100000000"), which would make this
    // assertion fragile to a formatting change unrelated to what we're
    // actually proving — that the value round-trips exactly.
    expect(reread.totalSpent.toFixed(2)).toBe("100000000.00");
    expect(reread.averageOrder.toFixed(2)).toBe("12345678.90");
  });
});
