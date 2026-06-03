-- Phase 1 / Step F marketing decoupling — drop the 4 cross-context FKs.
--
-- These are the last hard links between the marketing bounded context and core.
-- All four were already ON DELETE SET NULL, so there is ZERO cascade-behavior
-- change: a deleted tenant/plan/marketer already left these columns NULL via app
-- logic. We simply stop enforcing referential integrity at the DB so the
-- marketing tables (leads, commissions, lead_offers) can later live in a
-- separate database, and so payments stops being FK-bound to marketing_users.
--
-- The scalar columns are KEPT as plain soft references, with their existing
-- indexes (commissions_tenantId_idx, subscription_payments_referredByMarketingUserId_idx
-- from @@index; leads_convertedTenantId_key from @unique). Idempotent via IF EXISTS.
ALTER TABLE "leads"                 DROP CONSTRAINT IF EXISTS "leads_convertedTenantId_fkey";
ALTER TABLE "commissions"           DROP CONSTRAINT IF EXISTS "commissions_tenantId_fkey";
ALTER TABLE "lead_offers"           DROP CONSTRAINT IF EXISTS "lead_offers_planId_fkey";
ALTER TABLE "subscription_payments" DROP CONSTRAINT IF EXISTS "subscription_payments_referredByMarketingUserId_fkey";
