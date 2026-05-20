-- Per-plan marketing commission rate. Default matches the legacy
-- hardcoded SIGNUP_COMMISSION_RATE (10%) so existing tenants and
-- subscriptions keep their current payout math; managers can later
-- tweak per plan via /superadmin/plans.

ALTER TABLE "subscription_plans"
ADD COLUMN "commissionRate" DECIMAL(5, 4) NOT NULL DEFAULT 0.10;
