-- Rollback: recreate pending_plan_changes exactly as 20250109_subscription_system
-- defined it.
--
-- Recreating it EMPTY is the honest restore. The table only ever held
-- in-flight checkouts (each with an hour's TTL, swept by cron), so there was
-- nothing durable to preserve — and a rollback that invented rows would be
-- worse than one that admits the table starts empty.

CREATE TABLE IF NOT EXISTS "pending_plan_changes" (
  "id"             TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "targetPlanId"   TEXT NOT NULL,
  "billingCycle"   TEXT NOT NULL,
  "merchantOid"    TEXT NOT NULL,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pending_plan_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pending_plan_changes_merchantOid_key"
  ON "pending_plan_changes"("merchantOid");
CREATE INDEX IF NOT EXISTS "pending_plan_changes_subscriptionId_idx"
  ON "pending_plan_changes"("subscriptionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_plan_changes_subscriptionId_fkey'
  ) THEN
    ALTER TABLE "pending_plan_changes"
      ADD CONSTRAINT "pending_plan_changes_subscriptionId_fkey"
      FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_plan_changes_targetPlanId_fkey'
  ) THEN
    ALTER TABLE "pending_plan_changes"
      ADD CONSTRAINT "pending_plan_changes_targetPlanId_fkey"
      FOREIGN KEY ("targetPlanId") REFERENCES "subscription_plans"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
