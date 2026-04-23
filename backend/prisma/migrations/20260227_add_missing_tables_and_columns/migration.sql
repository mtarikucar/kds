-- Migration: Add all missing tables and columns that exist in schema.prisma
-- but have never had migration SQL generated for them.
-- These were previously applied via `prisma db push` in development only.

-- ========================================
-- 1. MISSING COLUMNS ON EXISTING TABLES
-- ========================================

-- Add personnelManagement to subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "personnelManagement" BOOLEAN NOT NULL DEFAULT false;

-- Enable personnelManagement for PRO and BUSINESS plans
UPDATE "subscription_plans" SET "personnelManagement" = true WHERE "name" IN ('PRO', 'BUSINESS');

-- Add onboardingData to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingData" JSONB;

-- Add delivery platform fields to orders
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "externalData" JSONB;

-- Add indexes for new order fields
CREATE INDEX IF NOT EXISTS "orders_source_idx" ON "orders"("source");
CREATE INDEX IF NOT EXISTS "orders_externalOrderId_idx" ON "orders"("externalOrderId");

-- ========================================
-- 2. SUPER ADMIN & AUTH TABLES
-- ========================================

-- CreateTable: super_admins
CREATE TABLE IF NOT EXISTS "super_admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastLogin" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "super_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "super_admins_email_key" ON "super_admins"("email");

-- CreateTable: audit_logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "metadata" JSONB,
    "targetTenantId" TEXT,
    "targetTenantName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_actorId_idx" ON "audit_logs"("actorId");
CREATE INDEX IF NOT EXISTS "audit_logs_entityType_idx" ON "audit_logs"("entityType");
CREATE INDEX IF NOT EXISTS "audit_logs_targetTenantId_idx" ON "audit_logs"("targetTenantId");
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateTable: user_activities
CREATE TABLE IF NOT EXISTS "user_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_activities_userId_idx" ON "user_activities"("userId");
CREATE INDEX IF NOT EXISTS "user_activities_tenantId_idx" ON "user_activities"("tenantId");
CREATE INDEX IF NOT EXISTS "user_activities_createdAt_idx" ON "user_activities"("createdAt");

-- ========================================
-- 3. RESTAURANT LAYOUT TABLE
-- ========================================

CREATE TABLE IF NOT EXISTS "restaurant_layouts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Main Floor',
    "width" INTEGER NOT NULL DEFAULT 32,
    "height" INTEGER NOT NULL DEFAULT 8,
    "depth" INTEGER NOT NULL DEFAULT 32,
    "worldData" JSONB NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "restaurant_layouts_tenantId_key" ON "restaurant_layouts"("tenantId");
CREATE INDEX IF NOT EXISTS "restaurant_layouts_tenantId_idx" ON "restaurant_layouts"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_layouts_tenantId_fkey') THEN
        ALTER TABLE "restaurant_layouts" ADD CONSTRAINT "restaurant_layouts_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ========================================
-- 4. ANALYTICS / CAMERA SYSTEM
-- ========================================

-- CreateTable: edge_devices (must be created before cameras due to FK)
CREATE TABLE IF NOT EXISTS "edge_devices" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hardwareType" TEXT,
    "firmwareVersion" TEXT,
    "ipAddress" TEXT,
    "macAddress" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastHeartbeat" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "capabilities" JSONB,
    "config" JSONB,
    "cpuUsage" DOUBLE PRECISION,
    "memoryUsage" DOUBLE PRECISION,
    "gpuUsage" DOUBLE PRECISION,
    "temperature" DOUBLE PRECISION,
    "uptime" INTEGER,
    "framesProcessed" BIGINT NOT NULL DEFAULT 0,
    "detectionsTotal" BIGINT NOT NULL DEFAULT 0,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "edge_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "edge_devices_tenantId_deviceId_key" ON "edge_devices"("tenantId", "deviceId");
CREATE INDEX IF NOT EXISTS "edge_devices_tenantId_idx" ON "edge_devices"("tenantId");
CREATE INDEX IF NOT EXISTS "edge_devices_status_idx" ON "edge_devices"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'edge_devices_tenantId_fkey') THEN
        ALTER TABLE "edge_devices" ADD CONSTRAINT "edge_devices_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: cameras
CREATE TABLE IF NOT EXISTS "cameras" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "streamUrl" TEXT NOT NULL,
    "streamType" TEXT NOT NULL DEFAULT 'RTSP',
    "calibrationData" JSONB,
    "voxelX" DOUBLE PRECISION,
    "voxelY" DOUBLE PRECISION DEFAULT 2.5,
    "voxelZ" DOUBLE PRECISION,
    "rotationY" DOUBLE PRECISION DEFAULT 0,
    "fov" DOUBLE PRECISION DEFAULT 90,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "edgeDeviceId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cameras_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cameras_tenantId_name_key" ON "cameras"("tenantId", "name");
CREATE INDEX IF NOT EXISTS "cameras_tenantId_idx" ON "cameras"("tenantId");
CREATE INDEX IF NOT EXISTS "cameras_status_idx" ON "cameras"("status");
CREATE INDEX IF NOT EXISTS "cameras_edgeDeviceId_idx" ON "cameras"("edgeDeviceId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cameras_edgeDeviceId_fkey') THEN
        ALTER TABLE "cameras" ADD CONSTRAINT "cameras_edgeDeviceId_fkey"
        FOREIGN KEY ("edgeDeviceId") REFERENCES "edge_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cameras_tenantId_fkey') THEN
        ALTER TABLE "cameras" ADD CONSTRAINT "cameras_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: occupancy_records
CREATE TABLE IF NOT EXISTS "occupancy_records" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trackingId" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL,
    "positionZ" DOUBLE PRECISION NOT NULL,
    "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "tableId" TEXT,
    "cameraId" TEXT,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "occupancy_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "occupancy_records_tenantId_timestamp_idx" ON "occupancy_records"("tenantId", "timestamp");
CREATE INDEX IF NOT EXISTS "occupancy_records_tableId_idx" ON "occupancy_records"("tableId");
CREATE INDEX IF NOT EXISTS "occupancy_records_trackingId_timestamp_idx" ON "occupancy_records"("trackingId", "timestamp");
CREATE INDEX IF NOT EXISTS "occupancy_records_state_idx" ON "occupancy_records"("state");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'occupancy_records_tableId_fkey') THEN
        ALTER TABLE "occupancy_records" ADD CONSTRAINT "occupancy_records_tableId_fkey"
        FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'occupancy_records_tenantId_fkey') THEN
        ALTER TABLE "occupancy_records" ADD CONSTRAINT "occupancy_records_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: traffic_flow_records
CREATE TABLE IF NOT EXISTS "traffic_flow_records" (
    "id" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "cellX" INTEGER NOT NULL,
    "cellZ" INTEGER NOT NULL,
    "cellSize" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "personCount" INTEGER NOT NULL,
    "avgDwellTime" DOUBLE PRECISION,
    "entrances" INTEGER NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,
    "flowDirections" JSONB,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "traffic_flow_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "traffic_flow_records_tenantId_hourBucket_cellX_cellZ_key" ON "traffic_flow_records"("tenantId", "hourBucket", "cellX", "cellZ");
CREATE INDEX IF NOT EXISTS "traffic_flow_records_tenantId_hourBucket_idx" ON "traffic_flow_records"("tenantId", "hourBucket");
CREATE INDEX IF NOT EXISTS "traffic_flow_records_cellX_cellZ_idx" ON "traffic_flow_records"("cellX", "cellZ");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'traffic_flow_records_tenantId_fkey') THEN
        ALTER TABLE "traffic_flow_records" ADD CONSTRAINT "traffic_flow_records_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: table_analytics
CREATE TABLE IF NOT EXISTS "table_analytics" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "tableId" TEXT NOT NULL,
    "totalOccupiedMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalDiningMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalIdleMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalEmptyMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalSessions" INTEGER NOT NULL DEFAULT 0,
    "avgSessionDuration" DOUBLE PRECISION,
    "avgDiningDuration" DOUBLE PRECISION,
    "avgIdleDuration" DOUBLE PRECISION,
    "revenueGenerated" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "avgOrderValue" DECIMAL(10,2),
    "revenuePerMinute" DECIMAL(10,4),
    "utilizationScore" DOUBLE PRECISION,
    "peakHours" JSONB,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_analytics_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "table_analytics_tableId_date_key" ON "table_analytics"("tableId", "date");
CREATE INDEX IF NOT EXISTS "table_analytics_tenantId_date_idx" ON "table_analytics"("tenantId", "date");
CREATE INDEX IF NOT EXISTS "table_analytics_tableId_idx" ON "table_analytics"("tableId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_analytics_tableId_fkey') THEN
        ALTER TABLE "table_analytics" ADD CONSTRAINT "table_analytics_tableId_fkey"
        FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'table_analytics_tenantId_fkey') THEN
        ALTER TABLE "table_analytics" ADD CONSTRAINT "table_analytics_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: analytics_insights
CREATE TABLE IF NOT EXISTS "analytics_insights" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "affectedTableIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "affectedAreaData" JSONB,
    "supportingData" JSONB,
    "potentialImpact" TEXT,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "implementedAt" TIMESTAMP(3),
    "dismissedReason" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_insights_tenantId_status_idx" ON "analytics_insights"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "analytics_insights_tenantId_type_idx" ON "analytics_insights"("tenantId", "type");
CREATE INDEX IF NOT EXISTS "analytics_insights_tenantId_createdAt_idx" ON "analytics_insights"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "analytics_insights_severity_idx" ON "analytics_insights"("severity");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_insights_tenantId_fkey') THEN
        ALTER TABLE "analytics_insights" ADD CONSTRAINT "analytics_insights_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: analytics_heatmap_cache
CREATE TABLE IF NOT EXISTS "analytics_heatmap_cache" (
    "id" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "granularity" TEXT NOT NULL,
    "gridWidth" INTEGER NOT NULL,
    "gridDepth" INTEGER NOT NULL,
    "cellSize" DOUBLE PRECISION NOT NULL,
    "heatmapData" JSONB NOT NULL,
    "maxValue" DOUBLE PRECISION NOT NULL,
    "minValue" DOUBLE PRECISION NOT NULL,
    "metric" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analytics_heatmap_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_heatmap_cache_tenantId_startTime_endTime_granulari_key" ON "analytics_heatmap_cache"("tenantId", "startTime", "endTime", "granularity", "metric");
CREATE INDEX IF NOT EXISTS "analytics_heatmap_cache_tenantId_metric_idx" ON "analytics_heatmap_cache"("tenantId", "metric");
CREATE INDEX IF NOT EXISTS "analytics_heatmap_cache_expiresAt_idx" ON "analytics_heatmap_cache"("expiresAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analytics_heatmap_cache_tenantId_fkey') THEN
        ALTER TABLE "analytics_heatmap_cache" ADD CONSTRAINT "analytics_heatmap_cache_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ========================================
-- 5. DELIVERY PLATFORM INTEGRATION
-- ========================================

-- CreateTable: delivery_platform_configs
CREATE TABLE IF NOT EXISTS "delivery_platform_configs" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "credentials" JSONB,
    "accessToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "remoteRestaurantId" TEXT,
    "restaurantOpen" BOOLEAN NOT NULL DEFAULT false,
    "lastOrderPollAt" TIMESTAMP(3),
    "lastMenuSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "autoAccept" BOOLEAN NOT NULL DEFAULT true,
    "notifySound" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_platform_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_platform_configs_tenantId_platform_key" ON "delivery_platform_configs"("tenantId", "platform");
CREATE INDEX IF NOT EXISTS "delivery_platform_configs_tenantId_idx" ON "delivery_platform_configs"("tenantId");
CREATE INDEX IF NOT EXISTS "delivery_platform_configs_platform_idx" ON "delivery_platform_configs"("platform");
CREATE INDEX IF NOT EXISTS "delivery_platform_configs_isEnabled_idx" ON "delivery_platform_configs"("isEnabled");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_platform_configs_tenantId_fkey') THEN
        ALTER TABLE "delivery_platform_configs" ADD CONSTRAINT "delivery_platform_configs_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: delivery_platform_logs
CREATE TABLE IF NOT EXISTS "delivery_platform_logs" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "orderId" TEXT,
    "externalId" TEXT,
    "request" JSONB,
    "response" JSONB,
    "statusCode" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_platform_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delivery_platform_logs_tenantId_idx" ON "delivery_platform_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "delivery_platform_logs_platform_idx" ON "delivery_platform_logs"("platform");
CREATE INDEX IF NOT EXISTS "delivery_platform_logs_orderId_idx" ON "delivery_platform_logs"("orderId");
CREATE INDEX IF NOT EXISTS "delivery_platform_logs_success_idx" ON "delivery_platform_logs"("success");
CREATE INDEX IF NOT EXISTS "delivery_platform_logs_nextRetryAt_idx" ON "delivery_platform_logs"("nextRetryAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_platform_logs_tenantId_fkey') THEN
        ALTER TABLE "delivery_platform_logs" ADD CONSTRAINT "delivery_platform_logs_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: menu_item_mappings
CREATE TABLE IF NOT EXISTS "menu_item_mappings" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "externalData" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "productId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "menu_item_mappings_tenantId_platform_externalItemId_key" ON "menu_item_mappings"("tenantId", "platform", "externalItemId");
CREATE INDEX IF NOT EXISTS "menu_item_mappings_tenantId_idx" ON "menu_item_mappings"("tenantId");
CREATE INDEX IF NOT EXISTS "menu_item_mappings_productId_idx" ON "menu_item_mappings"("productId");
CREATE INDEX IF NOT EXISTS "menu_item_mappings_platform_idx" ON "menu_item_mappings"("platform");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_item_mappings_productId_fkey') THEN
        ALTER TABLE "menu_item_mappings" ADD CONSTRAINT "menu_item_mappings_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menu_item_mappings_tenantId_fkey') THEN
        ALTER TABLE "menu_item_mappings" ADD CONSTRAINT "menu_item_mappings_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ========================================
-- 6. INGREDIENT-LEVEL STOCK MANAGEMENT
-- ========================================

-- CreateTable: stock_item_categories
CREATE TABLE IF NOT EXISTS "stock_item_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_item_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_item_categories_tenantId_name_key" ON "stock_item_categories"("tenantId", "name");
CREATE INDEX IF NOT EXISTS "stock_item_categories_tenantId_idx" ON "stock_item_categories"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_item_categories_tenantId_fkey') THEN
        ALTER TABLE "stock_item_categories" ADD CONSTRAINT "stock_item_categories_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: stock_items
CREATE TABLE IF NOT EXISTS "stock_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL,
    "description" TEXT,
    "currentStock" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "costPerUnit" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "trackExpiry" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_items_tenantId_sku_key" ON "stock_items"("tenantId", "sku");
CREATE INDEX IF NOT EXISTS "stock_items_tenantId_idx" ON "stock_items"("tenantId");
CREATE INDEX IF NOT EXISTS "stock_items_categoryId_idx" ON "stock_items"("categoryId");
CREATE INDEX IF NOT EXISTS "stock_items_isActive_idx" ON "stock_items"("isActive");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_categoryId_fkey') THEN
        ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_categoryId_fkey"
        FOREIGN KEY ("categoryId") REFERENCES "stock_item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_items_tenantId_fkey') THEN
        ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: stock_batches
CREATE TABLE IF NOT EXISTS "stock_batches" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL,
    "costPerUnit" DECIMAL(10,4) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiryDate" TIMESTAMP(3),
    "stockItemId" TEXT NOT NULL,
    "purchaseOrderItemId" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_batches_tenantId_idx" ON "stock_batches"("tenantId");
CREATE INDEX IF NOT EXISTS "stock_batches_stockItemId_idx" ON "stock_batches"("stockItemId");
CREATE INDEX IF NOT EXISTS "stock_batches_expiryDate_idx" ON "stock_batches"("expiryDate");

-- CreateTable: recipes
CREATE TABLE IF NOT EXISTS "recipes" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "notes" TEXT,
    "yield" INTEGER NOT NULL DEFAULT 1,
    "productId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipes_productId_key" ON "recipes"("productId");
CREATE INDEX IF NOT EXISTS "recipes_tenantId_idx" ON "recipes"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_productId_fkey') THEN
        ALTER TABLE "recipes" ADD CONSTRAINT "recipes_productId_fkey"
        FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipes_tenantId_fkey') THEN
        ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: recipe_ingredients
CREATE TABLE IF NOT EXISTS "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "recipeId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "recipe_ingredients_recipeId_stockItemId_key" ON "recipe_ingredients"("recipeId", "stockItemId");
CREATE INDEX IF NOT EXISTS "recipe_ingredients_recipeId_idx" ON "recipe_ingredients"("recipeId");
CREATE INDEX IF NOT EXISTS "recipe_ingredients_stockItemId_idx" ON "recipe_ingredients"("stockItemId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_ingredients_recipeId_fkey') THEN
        ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey"
        FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recipe_ingredients_stockItemId_fkey') THEN
        ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: suppliers
CREATE TABLE IF NOT EXISTS "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "suppliers_tenantId_idx" ON "suppliers"("tenantId");
CREATE INDEX IF NOT EXISTS "suppliers_isActive_idx" ON "suppliers"("isActive");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_tenantId_fkey') THEN
        ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: supplier_stock_items
CREATE TABLE IF NOT EXISTS "supplier_stock_items" (
    "id" TEXT NOT NULL,
    "supplierSku" TEXT,
    "unitPrice" DECIMAL(10,4) NOT NULL,
    "isPreferred" BOOLEAN NOT NULL DEFAULT false,
    "supplierId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_stock_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "supplier_stock_items_supplierId_stockItemId_key" ON "supplier_stock_items"("supplierId", "stockItemId");
CREATE INDEX IF NOT EXISTS "supplier_stock_items_supplierId_idx" ON "supplier_stock_items"("supplierId");
CREATE INDEX IF NOT EXISTS "supplier_stock_items_stockItemId_idx" ON "supplier_stock_items"("stockItemId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_stock_items_supplierId_fkey') THEN
        ALTER TABLE "supplier_stock_items" ADD CONSTRAINT "supplier_stock_items_supplierId_fkey"
        FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_stock_items_stockItemId_fkey') THEN
        ALTER TABLE "supplier_stock_items" ADD CONSTRAINT "supplier_stock_items_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: purchase_orders
CREATE TABLE IF NOT EXISTS "purchase_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "expectedDate" TIMESTAMP(3),
    "supplierId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "purchase_orders_tenantId_orderNumber_key" ON "purchase_orders"("tenantId", "orderNumber");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenantId_idx" ON "purchase_orders"("tenantId");
CREATE INDEX IF NOT EXISTS "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");
CREATE INDEX IF NOT EXISTS "purchase_orders_status_idx" ON "purchase_orders"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_supplierId_fkey') THEN
        ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey"
        FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_tenantId_fkey') THEN
        ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: purchase_order_items
CREATE TABLE IF NOT EXISTS "purchase_order_items" (
    "id" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(10,3) NOT NULL,
    "quantityReceived" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(10,4) NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");
CREATE INDEX IF NOT EXISTS "purchase_order_items_stockItemId_idx" ON "purchase_order_items"("stockItemId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_purchaseOrderId_fkey') THEN
        ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_stockItemId_fkey') THEN
        ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- Now add FK for stock_batches (depends on stock_items and purchase_order_items)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_batches_stockItemId_fkey') THEN
        ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_batches_purchaseOrderItemId_fkey') THEN
        ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_purchaseOrderItemId_fkey"
        FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_batches_tenantId_fkey') THEN
        ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: ingredient_movements
CREATE TABLE IF NOT EXISTS "ingredient_movements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "costPerUnit" DECIMAL(10,4),
    "notes" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "stockItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingredient_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ingredient_movements_tenantId_idx" ON "ingredient_movements"("tenantId");
CREATE INDEX IF NOT EXISTS "ingredient_movements_stockItemId_idx" ON "ingredient_movements"("stockItemId");
CREATE INDEX IF NOT EXISTS "ingredient_movements_type_idx" ON "ingredient_movements"("type");
CREATE INDEX IF NOT EXISTS "ingredient_movements_referenceType_referenceId_idx" ON "ingredient_movements"("referenceType", "referenceId");
CREATE INDEX IF NOT EXISTS "ingredient_movements_createdAt_idx" ON "ingredient_movements"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredient_movements_stockItemId_fkey') THEN
        ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingredient_movements_tenantId_fkey') THEN
        ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: waste_logs
CREATE TABLE IF NOT EXISTS "waste_logs" (
    "id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "cost" DECIMAL(10,4),
    "stockItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "waste_logs_tenantId_idx" ON "waste_logs"("tenantId");
CREATE INDEX IF NOT EXISTS "waste_logs_stockItemId_idx" ON "waste_logs"("stockItemId");
CREATE INDEX IF NOT EXISTS "waste_logs_reason_idx" ON "waste_logs"("reason");
CREATE INDEX IF NOT EXISTS "waste_logs_createdAt_idx" ON "waste_logs"("createdAt");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waste_logs_stockItemId_fkey') THEN
        ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waste_logs_tenantId_fkey') THEN
        ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: stock_counts
CREATE TABLE IF NOT EXISTS "stock_counts" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "notes" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "stock_counts_tenantId_idx" ON "stock_counts"("tenantId");
CREATE INDEX IF NOT EXISTS "stock_counts_status_idx" ON "stock_counts"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_counts_tenantId_fkey') THEN
        ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: stock_count_items
CREATE TABLE IF NOT EXISTS "stock_count_items" (
    "id" TEXT NOT NULL,
    "expectedQty" DECIMAL(10,3) NOT NULL,
    "countedQty" DECIMAL(10,3),
    "variance" DECIMAL(10,3),
    "stockCountId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_count_items_stockCountId_stockItemId_key" ON "stock_count_items"("stockCountId", "stockItemId");
CREATE INDEX IF NOT EXISTS "stock_count_items_stockCountId_idx" ON "stock_count_items"("stockCountId");
CREATE INDEX IF NOT EXISTS "stock_count_items_stockItemId_idx" ON "stock_count_items"("stockItemId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_items_stockCountId_fkey') THEN
        ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stockCountId_fkey"
        FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_count_items_stockItemId_fkey') THEN
        ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stockItemId_fkey"
        FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: stock_settings
CREATE TABLE IF NOT EXISTS "stock_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enableAutoDeduction" BOOLEAN NOT NULL DEFAULT true,
    "deductOnStatus" TEXT NOT NULL DEFAULT 'PREPARING',
    "lowStockAlertDays" INTEGER NOT NULL DEFAULT 3,
    "poNumberPrefix" TEXT NOT NULL DEFAULT 'PO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_settings_tenantId_key" ON "stock_settings"("tenantId");
CREATE INDEX IF NOT EXISTS "stock_settings_tenantId_idx" ON "stock_settings"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_settings_tenantId_fkey') THEN
        ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ========================================
-- 7. PERSONNEL MANAGEMENT
-- ========================================

-- CreateTable: shift_templates (must be before shift_assignments)
CREATE TABLE IF NOT EXISTS "shift_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shift_templates_tenantId_idx" ON "shift_templates"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_templates_tenantId_fkey') THEN
        ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: shift_assignments
CREATE TABLE IF NOT EXISTS "shift_assignments" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "shiftTemplateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shift_assignments_userId_date_key" ON "shift_assignments"("userId", "date");
CREATE INDEX IF NOT EXISTS "shift_assignments_tenantId_idx" ON "shift_assignments"("tenantId");
CREATE INDEX IF NOT EXISTS "shift_assignments_tenantId_date_idx" ON "shift_assignments"("tenantId", "date");
CREATE INDEX IF NOT EXISTS "shift_assignments_userId_idx" ON "shift_assignments"("userId");
CREATE INDEX IF NOT EXISTS "shift_assignments_shiftTemplateId_idx" ON "shift_assignments"("shiftTemplateId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_assignments_userId_fkey') THEN
        ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_assignments_shiftTemplateId_fkey') THEN
        ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shiftTemplateId_fkey"
        FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_assignments_tenantId_fkey') THEN
        ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: attendances
CREATE TABLE IF NOT EXISTS "attendances" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "breakStart" TIMESTAMP(3),
    "breakEnd" TIMESTAMP(3),
    "totalWorkedMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CLOCKED_IN',
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "shiftAssignmentId" TEXT,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "attendances_userId_date_key" ON "attendances"("userId", "date");
CREATE INDEX IF NOT EXISTS "attendances_tenantId_idx" ON "attendances"("tenantId");
CREATE INDEX IF NOT EXISTS "attendances_tenantId_date_idx" ON "attendances"("tenantId", "date");
CREATE INDEX IF NOT EXISTS "attendances_userId_idx" ON "attendances"("userId");
CREATE INDEX IF NOT EXISTS "attendances_status_idx" ON "attendances"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_shiftAssignmentId_fkey') THEN
        ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shiftAssignmentId_fkey"
        FOREIGN KEY ("shiftAssignmentId") REFERENCES "shift_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_userId_fkey') THEN
        ALTER TABLE "attendances" ADD CONSTRAINT "attendances_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendances_tenantId_fkey') THEN
        ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable: shift_swap_requests
CREATE TABLE IF NOT EXISTS "shift_swap_requests" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requesterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "requesterAssignmentId" TEXT NOT NULL,
    "targetAssignmentId" TEXT NOT NULL,
    "approvedById" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_swap_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "shift_swap_requests_tenantId_idx" ON "shift_swap_requests"("tenantId");
CREATE INDEX IF NOT EXISTS "shift_swap_requests_requesterId_idx" ON "shift_swap_requests"("requesterId");
CREATE INDEX IF NOT EXISTS "shift_swap_requests_targetId_idx" ON "shift_swap_requests"("targetId");
CREATE INDEX IF NOT EXISTS "shift_swap_requests_status_idx" ON "shift_swap_requests"("status");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_swap_requests_requesterId_fkey') THEN
        ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requesterId_fkey"
        FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_swap_requests_targetId_fkey') THEN
        ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_targetId_fkey"
        FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_swap_requests_requesterAssignmentId_fkey') THEN
        ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requesterAssignmentId_fkey"
        FOREIGN KEY ("requesterAssignmentId") REFERENCES "shift_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_swap_requests_approvedById_fkey') THEN
        ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_approvedById_fkey"
        FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shift_swap_requests_tenantId_fkey') THEN
        ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
