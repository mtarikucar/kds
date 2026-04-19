-- Add tenantId to waiter_requests / bill_requests so tenant isolation no
-- longer depends exclusively on table.tenantId (table may become nullable).
-- Backfill from the parent table's tenantId in place, then enforce NOT NULL.
ALTER TABLE "waiter_requests" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "bill_requests" ADD COLUMN "tenantId" TEXT;

UPDATE "waiter_requests" w
SET "tenantId" = t."tenantId"
FROM "tables" t
WHERE w."tableId" = t."id" AND w."tenantId" IS NULL;

UPDATE "bill_requests" b
SET "tenantId" = t."tenantId"
FROM "tables" t
WHERE b."tableId" = t."id" AND b."tenantId" IS NULL;

ALTER TABLE "waiter_requests" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "bill_requests" ALTER COLUMN "tenantId" SET NOT NULL;

-- Loosen tableId to nullable + SetNull so tableless (counter) customers can
-- still request waiter/bill without a table row behind them.
ALTER TABLE "waiter_requests" DROP CONSTRAINT "waiter_requests_tableId_fkey";
ALTER TABLE "bill_requests"   DROP CONSTRAINT "bill_requests_tableId_fkey";

ALTER TABLE "waiter_requests" ALTER COLUMN "tableId" DROP NOT NULL;
ALTER TABLE "bill_requests"   ALTER COLUMN "tableId" DROP NOT NULL;

ALTER TABLE "waiter_requests"
  ADD CONSTRAINT "waiter_requests_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL;

ALTER TABLE "bill_requests"
  ADD CONSTRAINT "bill_requests_tableId_fkey"
  FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL;

CREATE INDEX "waiter_requests_tenantId_idx" ON "waiter_requests"("tenantId");
CREATE INDEX "waiter_requests_tenantId_status_idx"
  ON "waiter_requests"("tenantId", "status");

CREATE INDEX "bill_requests_tenantId_idx" ON "bill_requests"("tenantId");
CREATE INDEX "bill_requests_tenantId_status_idx"
  ON "bill_requests"("tenantId", "status");
