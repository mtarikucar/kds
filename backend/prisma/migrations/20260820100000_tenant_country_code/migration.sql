-- Add the single piece of country DATA: Tenant.countryCode.
--
-- Everything else that varies by country (currency, tax bands, phone
-- region, locale, providers) is derived in code from COUNTRY_PROFILES
-- (backend/src/common/country/country-profile.const.ts) — this column is
-- the only fact stored per tenant.
--
-- Defaults every existing AND future row to 'TR': every tenant that existed
-- when this shipped was Turkish, and nothing about their behaviour may
-- change. IF NOT EXISTS makes this a safe no-op if already applied.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "countryCode" TEXT NOT NULL DEFAULT 'TR';
