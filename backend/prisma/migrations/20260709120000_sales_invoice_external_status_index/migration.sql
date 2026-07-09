-- The hourly AccountingResyncScheduler scans for externalStatus = 'FAILED'
-- across all tenants; without an index that is a full seq scan of an
-- ever-growing table every hour (LIMIT cannot short-circuit when no row
-- matches). Plain btree (not partial) so it matches schema.prisma's
-- @@index([externalStatus]) exactly — CI (db push) and prod (migrate deploy)
-- must build the same index or they drift.
CREATE INDEX IF NOT EXISTS "sales_invoices_externalStatus_idx" ON "sales_invoices"("externalStatus");
