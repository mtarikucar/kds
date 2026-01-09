-- Remove PendingPlanChange table and add scheduled downgrade fields to Subscription

-- Step 1: Drop the pending_plan_changes table (cascade will handle FK constraints)
DROP TABLE IF EXISTS "pending_plan_changes" CASCADE;

-- Step 2: Add scheduled downgrade fields to subscriptions table
ALTER TABLE "subscriptions"
ADD COLUMN "scheduledDowngradePlanId" TEXT,
ADD COLUMN "scheduledDowngradeBillingCycle" TEXT;

-- Step 3: Add foreign key constraint for scheduledDowngradePlanId
ALTER TABLE "subscriptions"
ADD CONSTRAINT "subscriptions_scheduledDowngradePlanId_fkey"
FOREIGN KEY ("scheduledDowngradePlanId")
REFERENCES "subscription_plans"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Create index for scheduledDowngradePlanId
CREATE INDEX "subscriptions_scheduledDowngradePlanId_idx" ON "subscriptions"("scheduledDowngradePlanId");
