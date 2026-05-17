-- Add cancelledAt to orders so cancelled-order accounting aligns with
-- the paidAt-based PAID-order window in the z-report. Historical rows
-- stay NULL — the report query falls back to createdAt for those.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);

-- Hot-path composite indexes. CONCURRENTLY would be safer in production
-- but Prisma's migration runner doesn't support it; size of the orders
-- table at deploy time should still be small enough to lock briefly.
CREATE INDEX IF NOT EXISTS "orders_tenantId_status_paidAt_idx"
  ON "orders" ("tenantId", "status", "paidAt");

CREATE INDEX IF NOT EXISTS "orders_tenantId_status_cancelledAt_idx"
  ON "orders" ("tenantId", "status", "cancelledAt");

CREATE INDEX IF NOT EXISTS "notifications_tenantId_isGlobal_expiresAt_idx"
  ON "notifications" ("tenantId", "isGlobal", "expiresAt");

CREATE INDEX IF NOT EXISTS "reservations_tenantId_tableId_date_startTime_idx"
  ON "reservations" ("tenantId", "tableId", "date", "startTime");

CREATE INDEX IF NOT EXISTS "ingredient_movements_stockItemId_createdAt_idx"
  ON "ingredient_movements" ("stockItemId", "createdAt");
