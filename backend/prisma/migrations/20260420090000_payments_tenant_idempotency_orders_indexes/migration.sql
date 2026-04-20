-- Payment: add tenantId + idempotencyKey + unique per-order idempotency key,
-- plus tenant index. Backfill tenantId from the parent order in-place.
ALTER TABLE "payments" ADD COLUMN "tenantId" TEXT;
ALTER TABLE "payments" ADD COLUMN "idempotencyKey" TEXT;

UPDATE "payments" p
SET "tenantId" = o."tenantId"
FROM "orders" o
WHERE p."orderId" = o."id" AND p."tenantId" IS NULL;

ALTER TABLE "payments" ALTER COLUMN "tenantId" SET NOT NULL;

CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");
CREATE UNIQUE INDEX "payments_orderId_idempotencyKey_key"
  ON "payments"("orderId", "idempotencyKey");

-- Order: composite indexes to cover common filter combinations used in findAll.
CREATE INDEX "orders_tenantId_status_idx" ON "orders"("tenantId", "status");
CREATE INDEX "orders_tenantId_createdAt_idx" ON "orders"("tenantId", "createdAt");
CREATE INDEX "orders_tenantId_tableId_status_idx"
  ON "orders"("tenantId", "tableId", "status");
