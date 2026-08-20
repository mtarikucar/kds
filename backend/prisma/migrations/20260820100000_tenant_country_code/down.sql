-- Rollback for 20260820100000_tenant_country_code.
--
-- Drops exactly the column the up added. No other tenant data is touched.
-- IF NOT EXISTS/IF EXISTS on both sides makes the up/down pair idempotent
-- and safe to run twice in either direction.
ALTER TABLE "tenants" DROP COLUMN IF EXISTS "countryCode";
