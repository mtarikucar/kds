-- Add preparingAt and readyAt timestamps for accurate prep time tracking
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "preparingAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);

-- Add partial unique index for delivery order deduplication
-- Only applies when externalOrderId is not null (delivery orders)
CREATE UNIQUE INDEX IF NOT EXISTS "orders_tenant_source_external_uniq"
ON "orders" ("tenantId", "source", "externalOrderId")
WHERE "externalOrderId" IS NOT NULL;
