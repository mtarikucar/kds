-- AlterTable: Add discount fields to subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "discountEndDate" TIMESTAMP(3);
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "discountLabel" TEXT;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "discountPercentage" INTEGER;
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "discountStartDate" TIMESTAMP(3);
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "isDiscountActive" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Add report and timezone fields to tenants
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "closingTime" TEXT DEFAULT '23:00';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'TRY';
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reportEmailEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "reportEmails" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable: Add OAuth fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appleId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "authProvider" TEXT NOT NULL DEFAULT 'local';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;

-- AlterTable: Add email fields to z_reports
ALTER TABLE "z_reports" ADD COLUMN IF NOT EXISTS "emailError" TEXT;
ALTER TABLE "z_reports" ADD COLUMN IF NOT EXISTS "emailRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable: page_views for analytics
CREATE TABLE IF NOT EXISTS "page_views" (
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "city" TEXT,
    "region" TEXT,
    "sessionId" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable: public_reviews for testimonials
CREATE TABLE IF NOT EXISTS "public_reviews" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "restaurant" TEXT,
    "avatar" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "country" TEXT,
    "city" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable: public_stats_cache for caching stats
CREATE TABLE IF NOT EXISTS "public_stats_cache" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "totalViews" INTEGER NOT NULL DEFAULT 0,
    "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTenants" INTEGER NOT NULL DEFAULT 0,
    "countryDistribution" JSONB,
    "cityDistribution" JSONB,
    "viewsToday" INTEGER NOT NULL DEFAULT 0,
    "viewsThisWeek" INTEGER NOT NULL DEFAULT 0,
    "viewsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_stats_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: page_views indexes
CREATE INDEX IF NOT EXISTS "page_views_page_createdAt_idx" ON "page_views"("page", "createdAt");
CREATE INDEX IF NOT EXISTS "page_views_country_idx" ON "page_views"("country");
CREATE INDEX IF NOT EXISTS "page_views_city_idx" ON "page_views"("city");
CREATE INDEX IF NOT EXISTS "page_views_sessionId_idx" ON "page_views"("sessionId");

-- CreateIndex: public_reviews indexes
CREATE INDEX IF NOT EXISTS "public_reviews_status_createdAt_idx" ON "public_reviews"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "public_reviews_rating_idx" ON "public_reviews"("rating");

-- CreateIndex: users OAuth unique indexes (only if column exists)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_googleId_key') THEN
        CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'users_appleId_key') THEN
        CREATE UNIQUE INDEX "users_appleId_key" ON "users"("appleId");
    END IF;
END $$;
