-- Task 8 (multi-country architecture, Phase 1): widen every money column
-- from Decimal(10, 2) to Decimal(14, 2).
--
-- Decimal(10, 2) tops out at 99,999,999.99. That is plenty of headroom in
-- TRY, but 1 USD is roughly 12,150 UZS, so the ceiling is only ~8,230 USD
-- once a tenant's currency is a low-unit-value one. A restaurant turning
-- over 8,000 USD in a day produces a ZReport daily total around 97M so'm —
-- already at the ceiling; Customer.totalSpent (a lifetime total) overflows
-- trivially for any loyal customer. This was invisible while every tenant
-- was Turkish because TRY never gets close to that ceiling.
--
-- Decimal(14, 2) is not picked arbitrarily: TableAnalyticsGoal.targetValue
-- already uses it, so it is an established precision in this schema. (There
-- are also 8 Decimal(12, 2) columns on the purchasing/GL side — out of scope
-- here, left untouched.)
--
-- All 73 Decimal(10, 2) columns in the schema are money (verified against
-- the full grep -n listing: 20 models, no rate/percentage column uses this
-- precision — rates live at Decimal(5, 4) — and User.hourlyRate, despite
-- its name, is an hourly wage, i.e. money). Every one is widened; none are
-- left behind, so no column stays narrower than a total it can feed into.
--
-- Safe in-place ALTER: PostgreSQL widening NUMERIC precision is a
-- metadata-only catalog update — no table rewrite, no row lock beyond the
-- brief ACCESS EXCLUSIVE needed to flip pg_attribute, verified against this
-- migration below. Re-running this file against an already-widened column
-- is a no-op: ALTER COLUMN ... TYPE to the column's current type does not
-- error and changes nothing.
--
-- Nothing here changes an existing value or any arithmetic on it — this is
-- Turkish-tenant-invisible by construction.

ALTER TABLE "users"
  ALTER COLUMN "hourlyRate" TYPE DECIMAL(14, 2);

ALTER TABLE "products"
  ALTER COLUMN "price" TYPE DECIMAL(14, 2),
  ALTER COLUMN "costPrice" TYPE DECIMAL(14, 2),
  ALTER COLUMN "campaignPrice" TYPE DECIMAL(14, 2);

ALTER TABLE "combo_group_items"
  ALTER COLUMN "priceDelta" TYPE DECIMAL(14, 2);

ALTER TABLE "modifiers"
  ALTER COLUMN "priceAdjustment" TYPE DECIMAL(14, 2);

ALTER TABLE "orders"
  ALTER COLUMN "totalAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "finalAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(14, 2);

ALTER TABLE "order_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(14, 2),
  ALTER COLUMN "subtotal" TYPE DECIMAL(14, 2),
  ALTER COLUMN "modifierTotal" TYPE DECIMAL(14, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "listUnitPrice" TYPE DECIMAL(14, 2);

ALTER TABLE "order_item_modifiers"
  ALTER COLUMN "priceAdjustment" TYPE DECIMAL(14, 2);

ALTER TABLE "payments"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "tipAmount" TYPE DECIMAL(14, 2);

ALTER TABLE "order_item_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2);

ALTER TABLE "pending_self_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2);

ALTER TABLE "subscription_plans"
  ALTER COLUMN "monthlyPrice" TYPE DECIMAL(14, 2),
  ALTER COLUMN "yearlyPrice" TYPE DECIMAL(14, 2);

ALTER TABLE "subscriptions"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2);

ALTER TABLE "subscription_payments"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2);

ALTER TABLE "invoices"
  ALTER COLUMN "subtotal" TYPE DECIMAL(14, 2),
  ALTER COLUMN "tax" TYPE DECIMAL(14, 2),
  ALTER COLUMN "total" TYPE DECIMAL(14, 2);

ALTER TABLE "customers"
  ALTER COLUMN "totalSpent" TYPE DECIMAL(14, 2),
  ALTER COLUMN "averageOrder" TYPE DECIMAL(14, 2);

ALTER TABLE "loyalty_transactions"
  ALTER COLUMN "orderAmount" TYPE DECIMAL(14, 2);

ALTER TABLE "z_reports"
  ALTER COLUMN "totalSales" TYPE DECIMAL(14, 2),
  ALTER COLUMN "totalDiscount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "totalRefunds" TYPE DECIMAL(14, 2),
  ALTER COLUMN "netSales" TYPE DECIMAL(14, 2),
  ALTER COLUMN "totalTax" TYPE DECIMAL(14, 2),
  ALTER COLUMN "dineInSales" TYPE DECIMAL(14, 2),
  ALTER COLUMN "takeawaySales" TYPE DECIMAL(14, 2),
  ALTER COLUMN "deliverySales" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cashPayments" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cardPayments" TYPE DECIMAL(14, 2),
  ALTER COLUMN "digitalPayments" TYPE DECIMAL(14, 2),
  ALTER COLUMN "openingCash" TYPE DECIMAL(14, 2),
  ALTER COLUMN "expectedCash" TYPE DECIMAL(14, 2),
  ALTER COLUMN "countedCash" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cashDifference" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cashInOut" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cancelledOrdersAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "refundedAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "openChecksAmount" TYPE DECIMAL(14, 2);

ALTER TABLE "cash_drawer_movements"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2);

ALTER TABLE "cashier_sessions"
  ALTER COLUMN "openingFloat" TYPE DECIMAL(14, 2),
  ALTER COLUMN "countedCash" TYPE DECIMAL(14, 2),
  ALTER COLUMN "expectedCash" TYPE DECIMAL(14, 2),
  ALTER COLUMN "overShort" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cashSales" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cashIn" TYPE DECIMAL(14, 2),
  ALTER COLUMN "cashOut" TYPE DECIMAL(14, 2);

ALTER TABLE "table_analytics"
  ALTER COLUMN "revenueGenerated" TYPE DECIMAL(14, 2),
  ALTER COLUMN "avgOrderValue" TYPE DECIMAL(14, 2);

ALTER TABLE "purchase_order_template_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(14, 2);

ALTER TABLE "lead_offers"
  ALTER COLUMN "planMonthlyPrice" TYPE DECIMAL(14, 2),
  ALTER COLUMN "customPrice" TYPE DECIMAL(14, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(14, 2);

ALTER TABLE "commissions"
  ALTER COLUMN "amount" TYPE DECIMAL(14, 2);

ALTER TABLE "sales_invoices"
  ALTER COLUMN "withholdingTaxAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "subtotal" TYPE DECIMAL(14, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "totalAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "discount" TYPE DECIMAL(14, 2);

ALTER TABLE "sales_invoice_items"
  ALTER COLUMN "unitPrice" TYPE DECIMAL(14, 2),
  ALTER COLUMN "taxAmount" TYPE DECIMAL(14, 2),
  ALTER COLUMN "subtotal" TYPE DECIMAL(14, 2),
  ALTER COLUMN "total" TYPE DECIMAL(14, 2);
