-- v3.0.0 finalization: POS feature flag + maxBranches numeric cap on SubscriptionPlan.
--
-- Both columns are NOT NULL with safe defaults so the schema change is
-- additive and zero-downtime against the running app. The data UPDATEs
-- seed the tier matrix the seed.ts file pins so a fresh DB and a
-- migrated DB end up identical:
--
--   FREE     posAccess=false   maxBranches=1
--   BASIC    posAccess=true    maxBranches=1
--   PRO      posAccess=true    maxBranches=3
--   BUSINESS posAccess=true    maxBranches=-1 (unlimited per engine convention)
--
-- Rollback is a simple DROP COLUMN of both — no data loss outside the
-- two new fields.

ALTER TABLE "subscription_plans"
  ADD COLUMN "maxBranches" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "posAccess"   BOOLEAN NOT NULL DEFAULT true;

-- POS access — only FREE loses it. The column default keeps every other
-- plan row (including legacy and future entries) at posAccess=true.
UPDATE "subscription_plans" SET "posAccess"   = false WHERE "name" = 'FREE';

-- Branch caps — explicit per-tier values.
UPDATE "subscription_plans" SET "maxBranches" = 1  WHERE "name" IN ('FREE', 'BASIC');
UPDATE "subscription_plans" SET "maxBranches" = 3  WHERE "name" = 'PRO';
UPDATE "subscription_plans" SET "maxBranches" = -1 WHERE "name" = 'BUSINESS';
