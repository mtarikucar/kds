/*
  Warnings:

  - You are about to drop the `floor_plans` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `spatial_zones` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `table_spatial_data` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "floor_plans" DROP CONSTRAINT "floor_plans_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "spatial_zones" DROP CONSTRAINT "spatial_zones_floorPlanId_fkey";

-- DropForeignKey
ALTER TABLE "table_spatial_data" DROP CONSTRAINT "table_spatial_data_floorPlanId_fkey";

-- DropForeignKey
ALTER TABLE "table_spatial_data" DROP CONSTRAINT "table_spatial_data_tableId_fkey";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'POS';

-- DropTable
DROP TABLE "floor_plans";

-- DropTable
DROP TABLE "spatial_zones";

-- DropTable
DROP TABLE "table_spatial_data";

-- CreateTable
CREATE TABLE "platform_orders" (
    "id" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "platformOrderId" TEXT NOT NULL,
    "platformOrderNumber" TEXT,
    "orderId" TEXT,
    "platformStatus" TEXT NOT NULL,
    "internalStatus" TEXT NOT NULL,
    "rawOrderData" JSONB NOT NULL,
    "customerInfo" JSONB,
    "deliveryInfo" JSONB,
    "paymentInfo" JSONB,
    "platformCreatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "preparedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "platformTotal" DECIMAL(10,2) NOT NULL,
    "platformCommission" DECIMAL(10,2),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_product_mappings" (
    "id" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "platformProductId" TEXT NOT NULL,
    "platformCategoryId" TEXT,
    "productId" TEXT NOT NULL,
    "syncPrice" BOOLEAN NOT NULL DEFAULT true,
    "syncAvailability" BOOLEAN NOT NULL DEFAULT true,
    "priceMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_product_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_modifier_mappings" (
    "id" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "platformModifierId" TEXT NOT NULL,
    "platformGroupId" TEXT,
    "modifierId" TEXT NOT NULL,
    "syncPrice" BOOLEAN NOT NULL DEFAULT true,
    "priceMultiplier" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_modifier_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_sync_logs" (
    "id" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "requestData" JSONB,
    "responseData" JSONB,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "errorCode" TEXT,
    "platformOrderId" TEXT,
    "productId" TEXT,
    "durationMs" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_dead_letters" (
    "id" TEXT NOT NULL,
    "platformType" TEXT NOT NULL,
    "webhookType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "errorMessage" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_orders_orderId_key" ON "platform_orders"("orderId");

-- CreateIndex
CREATE INDEX "platform_orders_tenantId_idx" ON "platform_orders"("tenantId");

-- CreateIndex
CREATE INDEX "platform_orders_platformType_idx" ON "platform_orders"("platformType");

-- CreateIndex
CREATE INDEX "platform_orders_platformStatus_idx" ON "platform_orders"("platformStatus");

-- CreateIndex
CREATE INDEX "platform_orders_createdAt_idx" ON "platform_orders"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_orders_tenantId_platformType_platformOrderId_key" ON "platform_orders"("tenantId", "platformType", "platformOrderId");

-- CreateIndex
CREATE INDEX "platform_product_mappings_tenantId_idx" ON "platform_product_mappings"("tenantId");

-- CreateIndex
CREATE INDEX "platform_product_mappings_platformType_idx" ON "platform_product_mappings"("platformType");

-- CreateIndex
CREATE INDEX "platform_product_mappings_productId_idx" ON "platform_product_mappings"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_product_mappings_tenantId_platformType_productId_key" ON "platform_product_mappings"("tenantId", "platformType", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_product_mappings_tenantId_platformType_platformPro_key" ON "platform_product_mappings"("tenantId", "platformType", "platformProductId");

-- CreateIndex
CREATE INDEX "platform_modifier_mappings_tenantId_idx" ON "platform_modifier_mappings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_modifier_mappings_tenantId_platformType_modifierId_key" ON "platform_modifier_mappings"("tenantId", "platformType", "modifierId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_modifier_mappings_tenantId_platformType_platformMo_key" ON "platform_modifier_mappings"("tenantId", "platformType", "platformModifierId");

-- CreateIndex
CREATE INDEX "integration_sync_logs_tenantId_platformType_idx" ON "integration_sync_logs"("tenantId", "platformType");

-- CreateIndex
CREATE INDEX "integration_sync_logs_createdAt_idx" ON "integration_sync_logs"("createdAt");

-- CreateIndex
CREATE INDEX "integration_sync_logs_status_idx" ON "integration_sync_logs"("status");

-- CreateIndex
CREATE INDEX "webhook_dead_letters_tenantId_status_idx" ON "webhook_dead_letters"("tenantId", "status");

-- CreateIndex
CREATE INDEX "webhook_dead_letters_nextRetryAt_idx" ON "webhook_dead_letters"("nextRetryAt");

-- CreateIndex
CREATE INDEX "orders_source_idx" ON "orders"("source");

-- AddForeignKey
ALTER TABLE "platform_orders" ADD CONSTRAINT "platform_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_orders" ADD CONSTRAINT "platform_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_product_mappings" ADD CONSTRAINT "platform_product_mappings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_product_mappings" ADD CONSTRAINT "platform_product_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_modifier_mappings" ADD CONSTRAINT "platform_modifier_mappings_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "modifiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_modifier_mappings" ADD CONSTRAINT "platform_modifier_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
