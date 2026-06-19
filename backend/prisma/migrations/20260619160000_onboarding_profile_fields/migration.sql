-- Onboarding info-collection fields.
--
-- Phone is now required at registration; social signups (which can't collect
-- it on a form) complete a post-login onboarding page that also captures tax
-- office and the preferred UI language. Two nullable columns back those.
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "taxOffice" TEXT;
ALTER TABLE "users"   ADD COLUMN IF NOT EXISTS "locale"   TEXT;
