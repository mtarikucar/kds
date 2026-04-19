-- Soft-delete + platform-wide remote restaurant uniqueness so two
-- tenants can't claim the same vendor id across the platform.
ALTER TABLE "delivery_platform_configs" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "delivery_platform_configs_platform_remoteRestaurantId_key"
    ON "delivery_platform_configs"("platform", "remoteRestaurantId");

-- Prevent duplicate Order rows for the same external platform + external
-- id. Partial so internal POS orders (source/externalOrderId NULL) are
-- not constrained. Replaces the read-then-insert race in
-- DeliveryOrderService.processIncomingOrder.
CREATE UNIQUE INDEX "orders_tenantId_source_externalOrderId_key"
    ON "orders"("tenantId", "source", "externalOrderId")
    WHERE "source" IS NOT NULL AND "externalOrderId" IS NOT NULL;
