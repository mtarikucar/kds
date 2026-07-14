-- Rollback for ai_menu_quota_plan_gating. Removes exactly what the up added:
-- the quota ledger table and the three subscription_plans columns. Safe no-op
-- when already reverted; touches no other data.

DROP TABLE IF EXISTS "ai_generation_usage";

ALTER TABLE "subscription_plans"
  DROP COLUMN IF EXISTS "aiContentGeneration",
  DROP COLUMN IF EXISTS "maxMonthlyAiPhotos",
  DROP COLUMN IF EXISTS "maxMonthlyAiVideos";
