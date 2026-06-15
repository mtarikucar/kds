-- v3 branch-isolation FOUNDATION: widen 8 tenant-wide uniqueness
-- constraints to per-branch compound keys so two branches under the same
-- tenant can each own e.g. table #1, SKU "COKE", camera "Front Door", etc.
--
-- Each old constraint was STRICTLY tighter than the new one (the old key is
-- a prefix/subset of the new key in every case except Recipe, where the old
-- key was a single column now joined with branchId), so no pre-existing row
-- can violate the looser compound key — these apply cleanly with no data fix.
--
-- All statements are idempotent (DROP ... IF EXISTS / CREATE ... IF NOT
-- EXISTS) so the migration is safe to re-run and tolerant of environments
-- where a prior partial run already created/dropped a subset.

-- 1) tables: (tenantId, number) -> (tenantId, branchId, number)
DROP INDEX IF EXISTS "tables_tenantId_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "tables_tenantId_branchId_number_key"
  ON "tables" ("tenantId", "branchId", "number");

-- 2) stock_items: (tenantId, sku) -> (tenantId, branchId, sku)
DROP INDEX IF EXISTS "stock_items_tenantId_sku_key";
CREATE UNIQUE INDEX IF NOT EXISTS "stock_items_tenantId_branchId_sku_key"
  ON "stock_items" ("tenantId", "branchId", "sku");

-- 3) recipes: (productId) -> (productId, branchId)
--    Drops the single-column unique so a product can hold one recipe per branch.
DROP INDEX IF EXISTS "recipes_productId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "recipes_productId_branchId_key"
  ON "recipes" ("productId", "branchId");

-- 4) z_reports: (tenantId, reportNumber) -> (tenantId, branchId, reportNumber)
DROP INDEX IF EXISTS "z_reports_tenantId_reportNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "z_reports_tenantId_branchId_reportNumber_key"
  ON "z_reports" ("tenantId", "branchId", "reportNumber");

-- 5) cameras: (tenantId, name) -> (tenantId, branchId, name)
DROP INDEX IF EXISTS "cameras_tenantId_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "cameras_tenantId_branchId_name_key"
  ON "cameras" ("tenantId", "branchId", "name");

-- 6) analytics_heatmap_cache: (tenantId, startTime, endTime, granularity, metric)
--    -> (tenantId, branchId, startTime, endTime, granularity, metric)
--    NOTE: both old and new names are Prisma-truncated to 63 bytes.
DROP INDEX IF EXISTS "analytics_heatmap_cache_tenantId_startTime_endTime_granulari_key";
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_heatmap_cache_tenantId_branchId_startTime_endTime_key"
  ON "analytics_heatmap_cache" ("tenantId", "branchId", "startTime", "endTime", "granularity", "metric");

-- 7) shift_assignments: (userId, date) -> (userId, date, branchId)
DROP INDEX IF EXISTS "shift_assignments_userId_date_key";
CREATE UNIQUE INDEX IF NOT EXISTS "shift_assignments_userId_date_branchId_key"
  ON "shift_assignments" ("userId", "date", "branchId");

-- 8) traffic_flow_records: (tenantId, hourBucket, cellX, cellZ)
--    -> (tenantId, branchId, hourBucket, cellX, cellZ)
--    NOTE: the new name is Prisma-truncated to 63 bytes.
DROP INDEX IF EXISTS "traffic_flow_records_tenantId_hourBucket_cellX_cellZ_key";
CREATE UNIQUE INDEX IF NOT EXISTS "traffic_flow_records_tenantId_branchId_hourBucket_cellX_cel_key"
  ON "traffic_flow_records" ("tenantId", "branchId", "hourBucket", "cellX", "cellZ");
