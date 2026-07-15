-- Composite read index for the heatmap/occupancy queries, which filter by
-- (tenantId, branchId, timestamp range). The existing (tenantId, timestamp)
-- and (tenantId, branchId) indexes force a filter step on multi-branch
-- tenants; this covers the exact access path — and the nightly retention
-- sweep's timestamp-cutoff subquery. Idempotent; reversible via down.sql.

CREATE INDEX IF NOT EXISTS "occupancy_records_tenantId_branchId_timestamp_idx"
  ON "occupancy_records"("tenantId", "branchId", "timestamp");
