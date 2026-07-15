-- Dedicated monthly cap for AI 3D-model generation (Meshy). Until now the 3D
-- rail drew 1 unit from the PHOTO allowance, but a 3D model is a ~₺12 vendor
-- charge (~9× a photo) — it needs its own pool. Values: TRIAL 1 (taster),
-- BASIC/FREE 0 (no AI), PRO 10 (~₺120 worst-case), BUSINESS 30 (~₺360).
-- Idempotent; reversible via down.sql.

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "maxMonthlyAi3dModels" INTEGER NOT NULL DEFAULT 0;

UPDATE "subscription_plans" SET "maxMonthlyAi3dModels" = 1  WHERE "name" = 'TRIAL';
UPDATE "subscription_plans" SET "maxMonthlyAi3dModels" = 10 WHERE "name" = 'PRO';
UPDATE "subscription_plans" SET "maxMonthlyAi3dModels" = 30 WHERE "name" = 'BUSINESS';
UPDATE "subscription_plans" SET "maxMonthlyAi3dModels" = 0  WHERE "name" IN ('BASIC', 'FREE');
