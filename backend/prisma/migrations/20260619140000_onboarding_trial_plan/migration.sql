-- Onboarding-trial redesign — set up the plan catalog.
--
-- New tenants start on a dedicated, non-purchasable TRIAL plan (7-day full
-- premium). At expiry the subscription goes to TRIAL_ENDED (locked) and the
-- tenant must activate a paid plan. This decouples the trial from BUSINESS
-- (the old design ran the trial on BUSINESS, coupling signup to
-- BUSINESS.trialDays) and retires FREE (no post-trial free landing).
--
-- The system is not yet in production use, so there is no live tenant/trial/
-- FREE data to migrate; this brings the plan catalog in line with the new
-- model. Idempotent (ADD COLUMN IF NOT EXISTS + upsert-by-unique-name).

-- 1) Self-serve / purchasable flag on plans.
ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;

-- 2) Paid tiers are purchasable; per-plan trials are removed (single
--    onboarding trial only), so their trialDays go to 0.
UPDATE "subscription_plans"
   SET "isPublic" = true, "trialDays" = 0
 WHERE "name" IN ('BASIC', 'PRO', 'BUSINESS');

-- 3) Retire FREE — no post-trial free landing, nothing lands on it. Keep the
--    row (avoid FK churn) but deactivate + hide it.
UPDATE "subscription_plans"
   SET "isActive" = false, "isPublic" = false
 WHERE "name" = 'FREE';

-- 4) Create (or refresh) the TRIAL onboarding plan: full premium, 7-day
--    trial, not purchasable, hidden from pricing. Mirrors BUSINESS's
--    unlimited limits + all features open.
INSERT INTO "subscription_plans" (
  "id", "name", "displayName", "description",
  "monthlyPrice", "yearlyPrice", "currency", "trialDays",
  "maxUsers", "maxTables", "maxBranches", "maxProducts", "maxCategories", "maxMonthlyOrders",
  "advancedReports", "multiLocation", "customBranding", "apiAccess", "prioritySupport",
  "inventoryTracking", "kdsIntegration", "reservationSystem", "personnelManagement",
  "deliveryIntegration", "posAccess",
  "commissionRate", "isActive", "isPublic", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(), 'TRIAL', 'Deneme', '7 günlük tam özellikli onboarding denemesi',
  0, 0, 'TRY', 7,
  -1, -1, -1, -1, -1, -1,
  true, true, true, true, true,
  true, true, true, true,
  true, true,
  0.10, true, false, NOW(), NOW()
)
ON CONFLICT ("name") DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  "description" = EXCLUDED."description",
  "monthlyPrice" = 0, "yearlyPrice" = 0, "currency" = 'TRY', "trialDays" = 7,
  "maxUsers" = -1, "maxTables" = -1, "maxBranches" = -1, "maxProducts" = -1,
  "maxCategories" = -1, "maxMonthlyOrders" = -1,
  "advancedReports" = true, "multiLocation" = true, "customBranding" = true,
  "apiAccess" = true, "prioritySupport" = true, "inventoryTracking" = true,
  "kdsIntegration" = true, "reservationSystem" = true, "personnelManagement" = true,
  "deliveryIntegration" = true, "posAccess" = true,
  "isActive" = true, "isPublic" = false, "updatedAt" = NOW();
