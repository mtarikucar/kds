-- Add branchId to tables. New tables created via the branches UI populate
-- it; pre-existing tables keep null and continue to behave tenant-scoped.
-- OrdersService.create copies it onto the order so branch-scoped reports
-- pick up new orders automatically.

ALTER TABLE "tables" ADD COLUMN "branchId" TEXT;

CREATE INDEX "tables_tenantId_branchId_idx" ON "tables" ("tenantId", "branchId");

ALTER TABLE "tables" ADD CONSTRAINT "tables_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
