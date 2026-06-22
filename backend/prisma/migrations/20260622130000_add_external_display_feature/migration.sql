-- Partner Display API: add the externalDisplay feature flag to subscription plans.
-- Additive, NOT NULL DEFAULT false (zero-downtime). TRIAL + BUSINESS tiers get it
-- so the remote-screen integration is reachable on those plans out of the box.
ALTER TABLE "subscription_plans"
  ADD COLUMN "externalDisplay" BOOLEAN NOT NULL DEFAULT false;

UPDATE "subscription_plans"
  SET "externalDisplay" = true
  WHERE "name" IN ('TRIAL', 'BUSINESS');
