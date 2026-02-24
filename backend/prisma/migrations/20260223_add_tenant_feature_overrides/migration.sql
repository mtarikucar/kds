-- Add feature & limit overrides to tenants
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "featureOverrides" JSONB;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "limitOverrides" JSONB;

-- Add reservationSystem feature flag to subscription_plans
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "reservationSystem" BOOLEAN NOT NULL DEFAULT false;

-- Enable reservationSystem for PRO and BUSINESS plans
UPDATE "subscription_plans" SET "reservationSystem" = true WHERE "name" IN ('PRO', 'BUSINESS');
