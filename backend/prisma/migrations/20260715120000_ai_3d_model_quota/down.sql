-- Rollback for ai_3d_model_quota: removes exactly the column the up added.
-- Safe no-op when already reverted; existing MODEL3D ledger rows in
-- ai_generation_usage are left untouched (harmless without the cap column —
-- the quota service treats a missing limit as 0/deny).

ALTER TABLE "subscription_plans"
  DROP COLUMN IF EXISTS "maxMonthlyAi3dModels";
