-- Add (tenantId, createdAt) compound indices to stock_movements and
-- ingredient_movements. Hot query pattern: "show me this tenant's
-- movements for the last 30 days" — without this, the planner uses
-- the tenantId-only index and then sequential-filters by date,
-- which gets slow at multi-month tenant history.
--
-- Postgres CREATE INDEX is non-blocking only with CONCURRENTLY, but
-- prisma migrations run in a transaction so we can't use that here.
-- Both tables are append-only and not in the hot read path during
-- migration; the brief lock is acceptable for a maintenance window.

CREATE INDEX "stock_movements_tenantId_createdAt_idx"
  ON "stock_movements" ("tenantId", "createdAt");

CREATE INDEX "ingredient_movements_tenantId_createdAt_idx"
  ON "ingredient_movements" ("tenantId", "createdAt");
