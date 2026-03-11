-- New columns on existing tables
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "externalData" JSONB;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "personnelManagement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "deliveryIntegration" BOOLEAN NOT NULL DEFAULT false;

-- Prevent cross-tenant webhook collision: enforce unique remoteRestaurantId per platform
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_platform_configs_platform_remoteRestaurantId_key" ON "delivery_platform_configs"("platform", "remoteRestaurantId") WHERE "remoteRestaurantId" IS NOT NULL AND "isEnabled" = true;

-- Create indexes on new columns
CREATE INDEX IF NOT EXISTS "orders_source_idx" ON "orders"("source");
CREATE INDEX IF NOT EXISTS "orders_externalOrderId_idx" ON "orders"("externalOrderId");
-- CreateTable
CREATE TABLE "delivery_platform_configs" (
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
-- CreateTable
CREATE TABLE "delivery_platform_logs" (
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
-- CreateTable
CREATE TABLE "menu_item_mappings" (
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
-- CreateTable
CREATE TABLE "stock_item_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_item_categories_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_items" (
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
-- CreateTable
CREATE TABLE "stock_batches" (
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
-- CreateTable
CREATE TABLE "recipes" (
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
-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "recipeId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "suppliers" (
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
-- CreateTable
CREATE TABLE "supplier_stock_items" (
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
-- CreateTable
CREATE TABLE "purchase_orders" (
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
-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(10,3) NOT NULL,
    "quantityReceived" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(10,4) NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ingredient_movements" (
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
-- CreateTable
CREATE TABLE "waste_logs" (
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
-- CreateTable
CREATE TABLE "stock_counts" (
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
-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" TEXT NOT NULL,
    "expectedQty" DECIMAL(10,3) NOT NULL,
    "countedQty" DECIMAL(10,3),
    "variance" DECIMAL(10,3),
    "stockCountId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stock_settings" (
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
-- CreateTable
CREATE TABLE "attendances" (
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
-- CreateTable
CREATE TABLE "shift_templates" (
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
-- CreateTable
CREATE TABLE "shift_assignments" (
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
-- CreateTable
CREATE TABLE "shift_swap_requests" (
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
CREATE INDEX "delivery_platform_configs_tenantId_idx" ON "delivery_platform_configs"("tenantId");
CREATE INDEX "delivery_platform_configs_platform_idx" ON "delivery_platform_configs"("platform");
CREATE INDEX "delivery_platform_configs_isEnabled_idx" ON "delivery_platform_configs"("isEnabled");
CREATE UNIQUE INDEX "delivery_platform_configs_tenantId_platform_key" ON "delivery_platform_configs"("tenantId", "platform");
CREATE INDEX "delivery_platform_logs_tenantId_idx" ON "delivery_platform_logs"("tenantId");
CREATE INDEX "delivery_platform_logs_platform_idx" ON "delivery_platform_logs"("platform");
CREATE INDEX "delivery_platform_logs_orderId_idx" ON "delivery_platform_logs"("orderId");
CREATE INDEX "delivery_platform_logs_success_idx" ON "delivery_platform_logs"("success");
CREATE INDEX "delivery_platform_logs_nextRetryAt_idx" ON "delivery_platform_logs"("nextRetryAt");
CREATE INDEX "menu_item_mappings_tenantId_idx" ON "menu_item_mappings"("tenantId");
CREATE INDEX "menu_item_mappings_productId_idx" ON "menu_item_mappings"("productId");
CREATE INDEX "menu_item_mappings_platform_idx" ON "menu_item_mappings"("platform");
CREATE UNIQUE INDEX "menu_item_mappings_tenantId_platform_externalItemId_key" ON "menu_item_mappings"("tenantId", "platform", "externalItemId");
CREATE INDEX "stock_item_categories_tenantId_idx" ON "stock_item_categories"("tenantId");
CREATE UNIQUE INDEX "stock_item_categories_tenantId_name_key" ON "stock_item_categories"("tenantId", "name");
CREATE INDEX "stock_items_tenantId_idx" ON "stock_items"("tenantId");
CREATE INDEX "stock_items_categoryId_idx" ON "stock_items"("categoryId");
CREATE INDEX "stock_items_isActive_idx" ON "stock_items"("isActive");
CREATE UNIQUE INDEX "stock_items_tenantId_sku_key" ON "stock_items"("tenantId", "sku");
CREATE INDEX "stock_batches_tenantId_idx" ON "stock_batches"("tenantId");
CREATE INDEX "stock_batches_stockItemId_idx" ON "stock_batches"("stockItemId");
CREATE INDEX "stock_batches_expiryDate_idx" ON "stock_batches"("expiryDate");
CREATE UNIQUE INDEX "recipes_productId_key" ON "recipes"("productId");
CREATE INDEX "recipes_tenantId_idx" ON "recipes"("tenantId");
CREATE INDEX "recipe_ingredients_recipeId_idx" ON "recipe_ingredients"("recipeId");
CREATE INDEX "recipe_ingredients_stockItemId_idx" ON "recipe_ingredients"("stockItemId");
CREATE UNIQUE INDEX "recipe_ingredients_recipeId_stockItemId_key" ON "recipe_ingredients"("recipeId", "stockItemId");
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");
CREATE INDEX "suppliers_isActive_idx" ON "suppliers"("isActive");
CREATE INDEX "supplier_stock_items_supplierId_idx" ON "supplier_stock_items"("supplierId");
CREATE INDEX "supplier_stock_items_stockItemId_idx" ON "supplier_stock_items"("stockItemId");
CREATE UNIQUE INDEX "supplier_stock_items_supplierId_stockItemId_key" ON "supplier_stock_items"("supplierId", "stockItemId");
CREATE INDEX "purchase_orders_tenantId_idx" ON "purchase_orders"("tenantId");
CREATE INDEX "purchase_orders_supplierId_idx" ON "purchase_orders"("supplierId");
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders"("status");
CREATE UNIQUE INDEX "purchase_orders_tenantId_orderNumber_key" ON "purchase_orders"("tenantId", "orderNumber");
CREATE INDEX "purchase_order_items_purchaseOrderId_idx" ON "purchase_order_items"("purchaseOrderId");
CREATE INDEX "purchase_order_items_stockItemId_idx" ON "purchase_order_items"("stockItemId");
CREATE INDEX "ingredient_movements_tenantId_idx" ON "ingredient_movements"("tenantId");
CREATE INDEX "ingredient_movements_stockItemId_idx" ON "ingredient_movements"("stockItemId");
CREATE INDEX "ingredient_movements_type_idx" ON "ingredient_movements"("type");
CREATE INDEX "ingredient_movements_referenceType_referenceId_idx" ON "ingredient_movements"("referenceType", "referenceId");
CREATE INDEX "ingredient_movements_createdAt_idx" ON "ingredient_movements"("createdAt");
CREATE INDEX "waste_logs_tenantId_idx" ON "waste_logs"("tenantId");
CREATE INDEX "waste_logs_stockItemId_idx" ON "waste_logs"("stockItemId");
CREATE INDEX "waste_logs_reason_idx" ON "waste_logs"("reason");
CREATE INDEX "waste_logs_createdAt_idx" ON "waste_logs"("createdAt");
CREATE INDEX "stock_counts_tenantId_idx" ON "stock_counts"("tenantId");
CREATE INDEX "stock_counts_status_idx" ON "stock_counts"("status");
CREATE INDEX "stock_count_items_stockCountId_idx" ON "stock_count_items"("stockCountId");
CREATE INDEX "stock_count_items_stockItemId_idx" ON "stock_count_items"("stockItemId");
CREATE UNIQUE INDEX "stock_count_items_stockCountId_stockItemId_key" ON "stock_count_items"("stockCountId", "stockItemId");
CREATE UNIQUE INDEX "stock_settings_tenantId_key" ON "stock_settings"("tenantId");
CREATE INDEX "stock_settings_tenantId_idx" ON "stock_settings"("tenantId");
CREATE INDEX "attendances_tenantId_idx" ON "attendances"("tenantId");
CREATE INDEX "attendances_tenantId_date_idx" ON "attendances"("tenantId", "date");
CREATE INDEX "attendances_userId_idx" ON "attendances"("userId");
CREATE INDEX "attendances_status_idx" ON "attendances"("status");
CREATE UNIQUE INDEX "attendances_userId_date_key" ON "attendances"("userId", "date");
CREATE INDEX "shift_templates_tenantId_idx" ON "shift_templates"("tenantId");
CREATE INDEX "shift_assignments_tenantId_idx" ON "shift_assignments"("tenantId");
CREATE INDEX "shift_assignments_tenantId_date_idx" ON "shift_assignments"("tenantId", "date");
CREATE INDEX "shift_assignments_userId_idx" ON "shift_assignments"("userId");
CREATE INDEX "shift_assignments_shiftTemplateId_idx" ON "shift_assignments"("shiftTemplateId");
CREATE UNIQUE INDEX "shift_assignments_userId_date_key" ON "shift_assignments"("userId", "date");
CREATE INDEX "shift_swap_requests_tenantId_idx" ON "shift_swap_requests"("tenantId");
CREATE INDEX "shift_swap_requests_requesterId_idx" ON "shift_swap_requests"("requesterId");
CREATE INDEX "shift_swap_requests_targetId_idx" ON "shift_swap_requests"("targetId");
CREATE INDEX "shift_swap_requests_status_idx" ON "shift_swap_requests"("status");
ALTER TABLE "delivery_platform_configs" ADD CONSTRAINT "delivery_platform_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delivery_platform_logs" ADD CONSTRAINT "delivery_platform_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "menu_item_mappings" ADD CONSTRAINT "menu_item_mappings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "menu_item_mappings" ADD CONSTRAINT "menu_item_mappings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_item_categories" ADD CONSTRAINT "stock_item_categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "stock_item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_stock_items" ADD CONSTRAINT "supplier_stock_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supplier_stock_items" ADD CONSTRAINT "supplier_stock_items_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ingredient_movements" ADD CONSTRAINT "ingredient_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stockCountId_fkey" FOREIGN KEY ("stockCountId") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendances" ADD CONSTRAINT "attendances_shiftAssignmentId_fkey" FOREIGN KEY ("shiftAssignmentId") REFERENCES "shift_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendances" ADD CONSTRAINT "attendances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attendances" ADD CONSTRAINT "attendances_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "shift_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requesterAssignmentId_fkey" FOREIGN KEY ("requesterAssignmentId") REFERENCES "shift_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_targetAssignmentId_fkey" FOREIGN KEY ("targetAssignmentId") REFERENCES "shift_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
