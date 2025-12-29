-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentPlanId" TEXT,
    "paymentRegion" TEXT NOT NULL DEFAULT 'INTERNATIONAL',
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationCode" VARCHAR(6),
    "emailVerificationCodeExpires" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "avatar" TEXT,
    "phone" TEXT,
    "lastLogin" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "image" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "stockTracked" BOOLEAN NOT NULL DEFAULT false,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "categoryId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_to_images" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_to_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifier_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "selectionType" TEXT NOT NULL DEFAULT 'SINGLE',
    "minSelections" INTEGER NOT NULL DEFAULT 0,
    "maxSelections" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modifiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "priceAdjustment" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "groupId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_modifier_groups" (
    "id" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "section" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floor_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Main Floor',
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "backgroundImage" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_spatial_data" (
    "id" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "positionX" DOUBLE PRECISION NOT NULL,
    "positionY" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "shape" TEXT NOT NULL DEFAULT 'RECTANGLE',
    "width" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "depth" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "floorPlanId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_spatial_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spatial_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "polygon" JSONB NOT NULL,
    "color" TEXT,
    "floorPlanId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spatial_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "finalAmount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "customerName" TEXT,
    "sessionId" TEXT,
    "customerPhone" TEXT,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "tableId" TEXT,
    "customerId" TEXT,
    "userId" TEXT,
    "approvedById" TEXT,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "modifierTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_modifiers" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceAdjustment" DECIMAL(10,2) NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "modifierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_modifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "notes" TEXT,
    "orderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "yearlyPrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "maxUsers" INTEGER NOT NULL DEFAULT 1,
    "maxTables" INTEGER NOT NULL DEFAULT 5,
    "maxProducts" INTEGER NOT NULL DEFAULT 50,
    "maxCategories" INTEGER NOT NULL DEFAULT 10,
    "maxMonthlyOrders" INTEGER NOT NULL DEFAULT 100,
    "advancedReports" BOOLEAN NOT NULL DEFAULT false,
    "multiLocation" BOOLEAN NOT NULL DEFAULT false,
    "customBranding" BOOLEAN NOT NULL DEFAULT false,
    "apiAccess" BOOLEAN NOT NULL DEFAULT false,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "inventoryTracking" BOOLEAN NOT NULL DEFAULT false,
    "kdsIntegration" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "billingCycle" TEXT NOT NULL,
    "paymentProvider" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "isTrialPeriod" BOOLEAN NOT NULL DEFAULT false,
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "paytrMerchantOid" TEXT,
    "paytrPaymentToken" TEXT,
    "renewalLinkSentAt" TIMESTAMP(3),
    "renewalLinkToken" TEXT,
    "graceEndDate" TIMESTAMP(3),
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentProvider" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "paytrMerchantOid" TEXT,
    "paytrPaymentToken" TEXT,
    "paymentMethod" TEXT,
    "last4" TEXT,
    "cardBrand" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "pdfUrl" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_plan_changes" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "currentPlanId" TEXT NOT NULL,
    "newPlanId" TEXT NOT NULL,
    "newBillingCycle" TEXT NOT NULL,
    "isUpgrade" BOOLEAN NOT NULL,
    "currentAmount" DECIMAL(10,2) NOT NULL,
    "newAmount" DECIMAL(10,2) NOT NULL,
    "prorationAmount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentRequired" BOOLEAN NOT NULL DEFAULT true,
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentIntentId" TEXT,
    "paymentProvider" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "reason" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_plan_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_menu_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "primaryColor" TEXT NOT NULL DEFAULT '#3B82F6',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1F2937',
    "backgroundColor" TEXT NOT NULL DEFAULT '#F9FAFB',
    "fontFamily" TEXT NOT NULL DEFAULT 'Inter',
    "logoUrl" TEXT,
    "showRestaurantInfo" BOOLEAN NOT NULL DEFAULT true,
    "showPrices" BOOLEAN NOT NULL DEFAULT true,
    "showDescription" BOOLEAN NOT NULL DEFAULT true,
    "showImages" BOOLEAN NOT NULL DEFAULT true,
    "layoutStyle" TEXT NOT NULL DEFAULT 'GRID',
    "itemsPerRow" INTEGER NOT NULL DEFAULT 2,
    "enableTableQR" BOOLEAN NOT NULL DEFAULT true,
    "tableQRMessage" TEXT NOT NULL DEFAULT 'Scan to view our menu',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_menu_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enableTablelessMode" BOOLEAN NOT NULL DEFAULT false,
    "enableTwoStepCheckout" BOOLEAN NOT NULL DEFAULT false,
    "showProductImages" BOOLEAN NOT NULL DEFAULT true,
    "enableCustomerOrdering" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "integrationType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isConfigured" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "webhookUrl" TEXT,
    "webhookEvents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "ipWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "loyaltyTier" TEXT NOT NULL DEFAULT 'BRONZE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "referralCode" TEXT,
    "referredBy" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "averageOrder" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "birthday" TIMESTAMP(3),
    "preferences" JSONB,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastVisit" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "customerId" TEXT,
    "tableId" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "orderId" TEXT,
    "orderNumber" TEXT,
    "orderAmount" DECIMAL(10,2),
    "referredCustomerId" TEXT,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_verifications" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT,
    "tenantId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT NOT NULL,
    "referralCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "referrerReward" INTEGER NOT NULL DEFAULT 0,
    "referredReward" INTEGER NOT NULL DEFAULT 0,
    "rewardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "customer_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB,
    "userId" TEXT,
    "tenantId" TEXT NOT NULL,
    "isGlobal" BOOLEAN NOT NULL DEFAULT false,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_reads" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waiter_requests" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sessionId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waiter_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_requests" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sessionId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desktop_releases" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "releaseTag" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "pubDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowsUrl" TEXT,
    "windowsSignature" TEXT,
    "macArmUrl" TEXT,
    "macArmSignature" TEXT,
    "macIntelUrl" TEXT,
    "macIntelSignature" TEXT,
    "linuxUrl" TEXT,
    "linuxSignature" TEXT,
    "releaseNotes" TEXT NOT NULL,
    "changelog" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desktop_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "z_reports" (
    "id" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "closingTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closingType" TEXT NOT NULL DEFAULT 'MANUAL',
    "closedById" TEXT NOT NULL,
    "branchName" TEXT,
    "terminalId" TEXT,
    "totalSales" DECIMAL(10,2) NOT NULL,
    "totalOrders" INTEGER NOT NULL,
    "totalDiscount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalRefunds" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(10,2) NOT NULL,
    "dineInSales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "dineInOrders" INTEGER NOT NULL DEFAULT 0,
    "takeawaySales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "takeawayOrders" INTEGER NOT NULL DEFAULT 0,
    "deliverySales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "deliveryOrders" INTEGER NOT NULL DEFAULT 0,
    "cashPayments" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cashPaymentCount" INTEGER NOT NULL DEFAULT 0,
    "cardPayments" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cardPaymentCount" INTEGER NOT NULL DEFAULT 0,
    "digitalPayments" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "digitalPaymentCount" INTEGER NOT NULL DEFAULT 0,
    "openingCash" DECIMAL(10,2) NOT NULL,
    "expectedCash" DECIMAL(10,2) NOT NULL,
    "countedCash" DECIMAL(10,2) NOT NULL,
    "cashDifference" DECIMAL(10,2) NOT NULL,
    "cashInOut" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cancelledOrders" INTEGER NOT NULL DEFAULT 0,
    "cancelledOrdersAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refundedPayments" INTEGER NOT NULL DEFAULT 0,
    "refundedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "staffPerformance" JSONB,
    "categoryBreakdown" JSONB,
    "topProducts" JSONB,
    "openChecks" INTEGER NOT NULL DEFAULT 0,
    "openChecksAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "systemGenerated" BOOLEAN NOT NULL DEFAULT false,
    "pdfExported" BOOLEAN NOT NULL DEFAULT false,
    "pdfUrl" TEXT,
    "excelExported" BOOLEAN NOT NULL DEFAULT false,
    "excelUrl" TEXT,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "z_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_drawer_movements" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "denominationBreakdown" JSONB,
    "zReportId" TEXT,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_drawer_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE INDEX "tenants_currentPlanId_idx" ON "tenants"("currentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_resetToken_key" ON "users"("resetToken");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "categories_tenantId_idx" ON "categories"("tenantId");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "product_images_tenantId_idx" ON "product_images"("tenantId");

-- CreateIndex
CREATE INDEX "product_to_images_productId_order_idx" ON "product_to_images"("productId", "order");

-- CreateIndex
CREATE INDEX "product_to_images_imageId_idx" ON "product_to_images"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "product_to_images_productId_imageId_key" ON "product_to_images"("productId", "imageId");

-- CreateIndex
CREATE INDEX "modifier_groups_tenantId_idx" ON "modifier_groups"("tenantId");

-- CreateIndex
CREATE INDEX "modifier_groups_isActive_idx" ON "modifier_groups"("isActive");

-- CreateIndex
CREATE INDEX "modifiers_groupId_idx" ON "modifiers"("groupId");

-- CreateIndex
CREATE INDEX "modifiers_tenantId_idx" ON "modifiers"("tenantId");

-- CreateIndex
CREATE INDEX "modifiers_isAvailable_idx" ON "modifiers"("isAvailable");

-- CreateIndex
CREATE INDEX "product_modifier_groups_productId_idx" ON "product_modifier_groups"("productId");

-- CreateIndex
CREATE INDEX "product_modifier_groups_groupId_idx" ON "product_modifier_groups"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "product_modifier_groups_productId_groupId_key" ON "product_modifier_groups"("productId", "groupId");

-- CreateIndex
CREATE INDEX "tables_tenantId_idx" ON "tables"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tables_tenantId_number_key" ON "tables"("tenantId", "number");

-- CreateIndex
CREATE INDEX "floor_plans_tenantId_idx" ON "floor_plans"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "table_spatial_data_tableId_key" ON "table_spatial_data"("tableId");

-- CreateIndex
CREATE INDEX "table_spatial_data_floorPlanId_idx" ON "table_spatial_data"("floorPlanId");

-- CreateIndex
CREATE INDEX "table_spatial_data_tableId_idx" ON "table_spatial_data"("tableId");

-- CreateIndex
CREATE INDEX "spatial_zones_floorPlanId_idx" ON "spatial_zones"("floorPlanId");

-- CreateIndex
CREATE INDEX "spatial_zones_tenantId_idx" ON "spatial_zones"("tenantId");

-- CreateIndex
CREATE INDEX "orders_tenantId_idx" ON "orders"("tenantId");

-- CreateIndex
CREATE INDEX "orders_userId_idx" ON "orders"("userId");

-- CreateIndex
CREATE INDEX "orders_tableId_idx" ON "orders"("tableId");

-- CreateIndex
CREATE INDEX "orders_customerId_idx" ON "orders"("customerId");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_sessionId_idx" ON "orders"("sessionId");

-- CreateIndex
CREATE INDEX "orders_approvedById_idx" ON "orders"("approvedById");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_orderNumber_key" ON "orders"("tenantId", "orderNumber");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

-- CreateIndex
CREATE INDEX "order_item_modifiers_orderItemId_idx" ON "order_item_modifiers"("orderItemId");

-- CreateIndex
CREATE INDEX "order_item_modifiers_modifierId_idx" ON "order_item_modifiers"("modifierId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_idx" ON "stock_movements"("tenantId");

-- CreateIndex
CREATE INDEX "stock_movements_productId_idx" ON "stock_movements"("productId");

-- CreateIndex
CREATE INDEX "stock_movements_userId_idx" ON "stock_movements"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_name_key" ON "subscription_plans"("name");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_paytrMerchantOid_key" ON "subscriptions"("paytrMerchantOid");

-- CreateIndex
CREATE INDEX "subscriptions_tenantId_idx" ON "subscriptions"("tenantId");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_currentPeriodEnd_idx" ON "subscriptions"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_stripePaymentIntentId_key" ON "subscription_payments"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_paytrMerchantOid_key" ON "subscription_payments"("paytrMerchantOid");

-- CreateIndex
CREATE INDEX "subscription_payments_subscriptionId_idx" ON "subscription_payments"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_payments_status_idx" ON "subscription_payments"("status");

-- CreateIndex
CREATE INDEX "subscription_payments_createdAt_idx" ON "subscription_payments"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentId_key" ON "invoices"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_subscriptionId_idx" ON "invoices"("subscriptionId");

-- CreateIndex
CREATE INDEX "invoices_invoiceNumber_idx" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_dueDate_idx" ON "invoices"("dueDate");

-- CreateIndex
CREATE INDEX "pending_plan_changes_subscriptionId_idx" ON "pending_plan_changes"("subscriptionId");

-- CreateIndex
CREATE INDEX "pending_plan_changes_paymentStatus_idx" ON "pending_plan_changes"("paymentStatus");

-- CreateIndex
CREATE INDEX "pending_plan_changes_scheduledFor_idx" ON "pending_plan_changes"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "qr_menu_settings_tenantId_key" ON "qr_menu_settings"("tenantId");

-- CreateIndex
CREATE INDEX "qr_menu_settings_tenantId_idx" ON "qr_menu_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_settings_tenantId_key" ON "pos_settings"("tenantId");

-- CreateIndex
CREATE INDEX "pos_settings_tenantId_idx" ON "pos_settings"("tenantId");

-- CreateIndex
CREATE INDEX "integration_settings_tenantId_idx" ON "integration_settings"("tenantId");

-- CreateIndex
CREATE INDEX "integration_settings_integrationType_idx" ON "integration_settings"("integrationType");

-- CreateIndex
CREATE UNIQUE INDEX "integration_settings_tenantId_integrationType_provider_key" ON "integration_settings"("tenantId", "integrationType", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

-- CreateIndex
CREATE INDEX "api_keys_key_idx" ON "api_keys"("key");

-- CreateIndex
CREATE INDEX "api_keys_isActive_idx" ON "api_keys"("isActive");

-- CreateIndex
CREATE INDEX "contact_messages_status_idx" ON "contact_messages"("status");

-- CreateIndex
CREATE INDEX "contact_messages_createdAt_idx" ON "contact_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customers_referralCode_key" ON "customers"("referralCode");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "customers_email_idx" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_referralCode_idx" ON "customers"("referralCode");

-- CreateIndex
CREATE INDEX "customers_loyaltyTier_idx" ON "customers"("loyaltyTier");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_email_key" ON "customers"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenantId_phone_key" ON "customers"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_sessionId_key" ON "customer_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "customer_sessions_sessionId_idx" ON "customer_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "customer_sessions_customerId_idx" ON "customer_sessions"("customerId");

-- CreateIndex
CREATE INDEX "customer_sessions_tenantId_idx" ON "customer_sessions"("tenantId");

-- CreateIndex
CREATE INDEX "customer_sessions_expiresAt_idx" ON "customer_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "loyalty_transactions_customerId_idx" ON "loyalty_transactions"("customerId");

-- CreateIndex
CREATE INDEX "loyalty_transactions_createdAt_idx" ON "loyalty_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "loyalty_transactions_type_idx" ON "loyalty_transactions"("type");

-- CreateIndex
CREATE INDEX "phone_verifications_phone_tenantId_idx" ON "phone_verifications"("phone", "tenantId");

-- CreateIndex
CREATE INDEX "phone_verifications_code_idx" ON "phone_verifications"("code");

-- CreateIndex
CREATE INDEX "phone_verifications_expiresAt_idx" ON "phone_verifications"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_referrals_referredId_key" ON "customer_referrals"("referredId");

-- CreateIndex
CREATE INDEX "customer_referrals_referrerId_idx" ON "customer_referrals"("referrerId");

-- CreateIndex
CREATE INDEX "customer_referrals_referredId_idx" ON "customer_referrals"("referredId");

-- CreateIndex
CREATE INDEX "customer_referrals_referralCode_idx" ON "customer_referrals"("referralCode");

-- CreateIndex
CREATE INDEX "customer_referrals_status_idx" ON "customer_referrals"("status");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "user_notification_reads_userId_idx" ON "user_notification_reads"("userId");

-- CreateIndex
CREATE INDEX "user_notification_reads_notificationId_idx" ON "user_notification_reads"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_reads_notificationId_userId_key" ON "user_notification_reads"("notificationId", "userId");

-- CreateIndex
CREATE INDEX "waiter_requests_tableId_idx" ON "waiter_requests"("tableId");

-- CreateIndex
CREATE INDEX "waiter_requests_status_idx" ON "waiter_requests"("status");

-- CreateIndex
CREATE INDEX "waiter_requests_sessionId_idx" ON "waiter_requests"("sessionId");

-- CreateIndex
CREATE INDEX "bill_requests_tableId_idx" ON "bill_requests"("tableId");

-- CreateIndex
CREATE INDEX "bill_requests_status_idx" ON "bill_requests"("status");

-- CreateIndex
CREATE INDEX "bill_requests_sessionId_idx" ON "bill_requests"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "desktop_releases_version_key" ON "desktop_releases"("version");

-- CreateIndex
CREATE UNIQUE INDEX "desktop_releases_releaseTag_key" ON "desktop_releases"("releaseTag");

-- CreateIndex
CREATE INDEX "desktop_releases_version_idx" ON "desktop_releases"("version");

-- CreateIndex
CREATE INDEX "desktop_releases_published_pubDate_idx" ON "desktop_releases"("published", "pubDate");

-- CreateIndex
CREATE INDEX "z_reports_tenantId_idx" ON "z_reports"("tenantId");

-- CreateIndex
CREATE INDEX "z_reports_reportDate_idx" ON "z_reports"("reportDate");

-- CreateIndex
CREATE INDEX "z_reports_closedById_idx" ON "z_reports"("closedById");

-- CreateIndex
CREATE UNIQUE INDEX "z_reports_tenantId_reportNumber_key" ON "z_reports"("tenantId", "reportNumber");

-- CreateIndex
CREATE INDEX "cash_drawer_movements_tenantId_idx" ON "cash_drawer_movements"("tenantId");

-- CreateIndex
CREATE INDEX "cash_drawer_movements_zReportId_idx" ON "cash_drawer_movements"("zReportId");

-- CreateIndex
CREATE INDEX "cash_drawer_movements_userId_idx" ON "cash_drawer_movements"("userId");

-- CreateIndex
CREATE INDEX "cash_drawer_movements_createdAt_idx" ON "cash_drawer_movements"("createdAt");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_to_images" ADD CONSTRAINT "product_to_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_to_images" ADD CONSTRAINT "product_to_images_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "product_images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "modifiers" ADD CONSTRAINT "modifiers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "product_modifier_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_spatial_data" ADD CONSTRAINT "table_spatial_data_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_spatial_data" ADD CONSTRAINT "table_spatial_data_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spatial_zones" ADD CONSTRAINT "spatial_zones_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "order_item_modifiers_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "modifiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "subscription_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_currentPlanId_fkey" FOREIGN KEY ("currentPlanId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_plan_changes" ADD CONSTRAINT "pending_plan_changes_newPlanId_fkey" FOREIGN KEY ("newPlanId") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_menu_settings" ADD CONSTRAINT "qr_menu_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_settings" ADD CONSTRAINT "pos_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_settings" ADD CONSTRAINT "integration_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_referrals" ADD CONSTRAINT "customer_referrals_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_referrals" ADD CONSTRAINT "customer_referrals_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_reads" ADD CONSTRAINT "user_notification_reads_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_reads" ADD CONSTRAINT "user_notification_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_requests" ADD CONSTRAINT "waiter_requests_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waiter_requests" ADD CONSTRAINT "waiter_requests_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_requests" ADD CONSTRAINT "bill_requests_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_requests" ADD CONSTRAINT "bill_requests_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "z_reports" ADD CONSTRAINT "z_reports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_zReportId_fkey" FOREIGN KEY ("zReportId") REFERENCES "z_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_drawer_movements" ADD CONSTRAINT "cash_drawer_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
