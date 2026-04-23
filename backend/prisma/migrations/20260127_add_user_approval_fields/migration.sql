-- AlterTable: Add user approval fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_approvedById_fkey') THEN
        ALTER TABLE "users" ADD CONSTRAINT "users_approvedById_fkey"
        FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndex (if not exists)
CREATE INDEX IF NOT EXISTS "users_approvedById_idx" ON "users"("approvedById");

-- AlterTable: Add social media and WiFi fields to tenants (if not already present)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "locationRadius" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wifiSsid" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "wifiPassword" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "socialInstagram" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "socialFacebook" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "socialTwitter" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "socialTiktok" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "socialYoutube" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "socialWhatsapp" TEXT;

-- AlterTable: Add geolocation fields to customer_sessions (if not already present)
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "customer_sessions" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

-- AlterTable: Add displayOrder field to products (if not already present)
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "displayOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Add totalOrders and totalRevenue to public_stats_cache (if not already present)
ALTER TABLE "public_stats_cache" ADD COLUMN IF NOT EXISTS "totalOrders" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public_stats_cache" ADD COLUMN IF NOT EXISTS "totalRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable: Add scheduledDowngrade fields to subscriptions (if not already present)
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "scheduledDowngradePlanId" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "scheduledDowngradeBillingCycle" TEXT;

-- AddForeignKey for scheduled downgrade
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_scheduledDowngradePlanId_fkey') THEN
        ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_scheduledDowngradePlanId_fkey"
        FOREIGN KEY ("scheduledDowngradePlanId") REFERENCES "subscription_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateIndex for scheduled downgrade
CREATE INDEX IF NOT EXISTS "subscriptions_scheduledDowngradePlanId_idx" ON "subscriptions"("scheduledDowngradePlanId");
