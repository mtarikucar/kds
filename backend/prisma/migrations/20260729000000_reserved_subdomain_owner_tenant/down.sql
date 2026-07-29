-- Rollback for reserved_subdomain_owner_tenant. Drops exactly the index and
-- column the up migration added — nothing else. Idempotent (IF EXISTS) and
-- touches no other data; safe no-op if already reverted.
DROP INDEX IF EXISTS "reserved_subdomains_tenantId_idx";
ALTER TABLE "reserved_subdomains" DROP COLUMN IF EXISTS "tenantId";
