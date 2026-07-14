-- AI menu-studio plan gating + monthly generation quotas.
-- Adds the aiContentGeneration feature flag and per-month photo/video caps to
-- subscription plans, plus the append-only ai_generation_usage quota ledger.
-- Quota values: TRIAL 3/1 (taster), BASIC 0/0 (no AI), PRO 50/5, BUSINESS 200/20.
-- Idempotent (IF NOT EXISTS everywhere); reversible via down.sql.

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "aiContentGeneration" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "maxMonthlyAiPhotos" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxMonthlyAiVideos" INTEGER NOT NULL DEFAULT 0;

UPDATE "subscription_plans"
  SET "aiContentGeneration" = true, "maxMonthlyAiPhotos" = 3, "maxMonthlyAiVideos" = 1
  WHERE "name" = 'TRIAL';

UPDATE "subscription_plans"
  SET "aiContentGeneration" = true, "maxMonthlyAiPhotos" = 50, "maxMonthlyAiVideos" = 5
  WHERE "name" = 'PRO';

UPDATE "subscription_plans"
  SET "aiContentGeneration" = true, "maxMonthlyAiPhotos" = 200, "maxMonthlyAiVideos" = 20
  WHERE "name" = 'BUSINESS';

-- BASIC + legacy FREE stay at the column defaults (false / 0 / 0); set them
-- explicitly so a re-run after manual tinkering still converges.
UPDATE "subscription_plans"
  SET "aiContentGeneration" = false, "maxMonthlyAiPhotos" = 0, "maxMonthlyAiVideos" = 0
  WHERE "name" IN ('BASIC', 'FREE');

-- Append-only quota ledger. Deliberately no FK to products/product_media_jobs:
-- product deletion cascades jobs away and usage must survive that (otherwise
-- deleting a product refunds its quota). voided=true = failed generation
-- (refunded).
CREATE TABLE IF NOT EXISTS "ai_generation_usage" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 1,
  "jobId" TEXT,
  "voided" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_generation_usage_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_usage_tenantId_fkey'
  ) THEN
    ALTER TABLE "ai_generation_usage"
      ADD CONSTRAINT "ai_generation_usage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ai_generation_usage_tenantId_kind_createdAt_idx"
  ON "ai_generation_usage"("tenantId", "kind", "createdAt");

CREATE INDEX IF NOT EXISTS "ai_generation_usage_jobId_idx"
  ON "ai_generation_usage"("jobId");
