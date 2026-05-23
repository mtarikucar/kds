-- Add branchId to orders so reports + ops dashboards can filter by branch.
--
-- Nullable: existing orders predate the Branch model and keep null. New
-- orders will set this from the cashier's session or the table's branch
-- once those plumbings land in the order-create path.

ALTER TABLE "orders" ADD COLUMN "branchId" TEXT;

-- Composite index for the most common report query: tenant + branch +
-- date window. Postgres can use the (tenantId, branchId, createdAt) prefix
-- for the tenant-only and (tenantId, branchId) variants too, so we don't
-- need separate indexes.
CREATE INDEX "orders_tenantId_branchId_createdAt_idx"
  ON "orders" ("tenantId", "branchId", "createdAt");

-- FK to branches with SET NULL on branch delete — same semantics as
-- the existing tableId column when a table is removed.
ALTER TABLE "orders" ADD CONSTRAINT "orders_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
