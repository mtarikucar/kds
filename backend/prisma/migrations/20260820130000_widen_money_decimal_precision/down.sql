-- Rollback of the Decimal(10, 2) -> Decimal(14, 2) widening.
--
-- This narrows precision back down, and narrowing NUMERIC(p,s) is the one
-- direction that is NOT automatically safe: PostgreSQL scans every row of
-- every altered column and raises "numeric field overflow", aborting the
-- whole statement (and, if this file is executed inside a transaction, the
-- whole rollback) if any stored value no longer fits Decimal(10, 2). It does
-- NOT silently truncate or round a value down to fit — a value with 11+
-- digits before the decimal point makes the ALTER fail loudly, the affected
-- table stays at Decimal(14, 2), and the operator has to deal with that
-- table's data before rollback can proceed for it. That refusal is by
-- design: silently truncating a stored money total would be worse than
-- refusing to roll back.
--
-- Each ALTER TABLE below is independent, so a table with an over-ceiling
-- value only blocks its own statement; tables that still fit narrow fine.
-- Idempotent: a column already at Decimal(10, 2) (rollback already applied,
-- or the up was never run) re-applies the same type with no error and no
-- effect.
--
-- No operator or runtime data is touched — this changes column type
-- metadata only, never a row's contents.

ALTER TABLE "users"
  ALTER COLUMN "hourlyRate" TYPE DECIMAL(10, 2);

ALTER TABLE "products"
  ALTER COLUMN "price" TYPE DECIMAL(10, 2),
  ALTER COLUMN "costPrice" TYPE DECIMAL(10, 2),
  ALTER COLUMN "campaignPrice" TYPE DECIMAL(10, 2);

ALTER TABLE "combo_group_items"
  ALTER COLUMN "priceDelta" TYPE DECIMAL(10, 2);

ALTER TABLE "modifiers"
  ALTER COLUMN "priceAdjustment" TYPE DECIMAL(10, 2);

ALTER TABLE "orders"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "finalAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(10, 2);

ALTER TABLE "order_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(10, 2),
  ALTER COLUMN "subtotal" TYPE DECIMAL(10, 2),
  ALTER COLUMN "modifierTotal" TYPE DECIMAL(10, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "listUnitPrice" TYPE DECIMAL(10, 2);

ALTER TABLE "order_item_modifiers"
  ALTER COLUMN "priceAdjustment" TYPE DECIMAL(10, 2);

ALTER TABLE "payments"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "tipAmount" TYPE DECIMAL(10, 2);

ALTER TABLE "order_item_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

ALTER TABLE "pending_self_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

ALTER TABLE "subscription_plans"
  ALTER COLUMN "monthlyPrice" TYPE DECIMAL(10, 2),
  ALTER COLUMN "yearlyPrice" TYPE DECIMAL(10, 2);

ALTER TABLE "subscriptions"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

ALTER TABLE "subscription_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

ALTER TABLE "invoices"
  ALTER COLUMN "subtotal" TYPE DECIMAL(10, 2),
  ALTER COLUMN "tax" TYPE DECIMAL(10, 2),
  ALTER COLUMN "total" TYPE DECIMAL(10, 2);

ALTER TABLE "customers"
  ALTER COLUMN "totalSpent" TYPE DECIMAL(10, 2),
  ALTER COLUMN "averageOrder" TYPE DECIMAL(10, 2);

ALTER TABLE "loyalty_transactions"
  ALTER COLUMN "orderAmount" TYPE DECIMAL(10, 2);

ALTER TABLE "z_reports"
  ALTER COLUMN "totalSales" TYPE DECIMAL(10, 2),
  ALTER COLUMN "totalDiscount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "totalRefunds" TYPE DECIMAL(10, 2),
  ALTER COLUMN "netSales" TYPE DECIMAL(10, 2),
  ALTER COLUMN "totalTax" TYPE DECIMAL(10, 2),
  ALTER COLUMN "dineInSales" TYPE DECIMAL(10, 2),
  ALTER COLUMN "takeawaySales" TYPE DECIMAL(10, 2),
  ALTER COLUMN "deliverySales" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cashPayments" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cardPayments" TYPE DECIMAL(10, 2),
  ALTER COLUMN "digitalPayments" TYPE DECIMAL(10, 2),
  ALTER COLUMN "openingCash" TYPE DECIMAL(10, 2),
  ALTER COLUMN "expectedCash" TYPE DECIMAL(10, 2),
  ALTER COLUMN "countedCash" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cashDifference" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cashInOut" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cancelledOrdersAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "refundedAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "openChecksAmount" TYPE DECIMAL(10, 2);

ALTER TABLE "cash_drawer_movements"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

ALTER TABLE "cashier_sessions"
  ALTER COLUMN "openingFloat" TYPE DECIMAL(10, 2),
  ALTER COLUMN "countedCash" TYPE DECIMAL(10, 2),
  ALTER COLUMN "expectedCash" TYPE DECIMAL(10, 2),
  ALTER COLUMN "overShort" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cashSales" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cashIn" TYPE DECIMAL(10, 2),
  ALTER COLUMN "cashOut" TYPE DECIMAL(10, 2);

ALTER TABLE "table_analytics"
  ALTER COLUMN "revenueGenerated" TYPE DECIMAL(10, 2),
  ALTER COLUMN "avgOrderValue" TYPE DECIMAL(10, 2);

ALTER TABLE "purchase_order_template_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(10, 2);

ALTER TABLE "lead_offers"
  ALTER COLUMN "planMonthlyPrice" TYPE DECIMAL(10, 2),
  ALTER COLUMN "customPrice" TYPE DECIMAL(10, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(10, 2);

ALTER TABLE "commissions"
  ALTER COLUMN "amount" TYPE DECIMAL(10, 2);

ALTER TABLE "sales_invoices"
  ALTER COLUMN "withholdingTaxAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "subtotal" TYPE DECIMAL(10, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "totalAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(10, 2);

ALTER TABLE "sales_invoice_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(10, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(10, 2),
  ALTER COLUMN "subtotal" TYPE DECIMAL(10, 2),
  ALTER COLUMN "total" TYPE DECIMAL(10, 2);
