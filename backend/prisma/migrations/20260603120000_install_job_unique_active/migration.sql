-- Enforce "one active (non-cancelled) installation job per tenant" at the DB
-- level. Backs the application-level check-then-act in
-- InstallationJobService.createForConversion (which now catches P2002).
--
-- Prisma's schema DSL can't express a partial unique index, so this lives in
-- raw SQL only (apply via `prisma migrate deploy`, not `db push`).

-- 1) Dedup existing data so the unique index can be created: keep the most
--    recent non-cancelled job per tenant, cancel the older duplicates.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "tenantId"
    ORDER BY "requestedAt" DESC, id DESC
  ) AS rn
  FROM "installation_jobs"
  WHERE status <> 'CANCELLED'
)
UPDATE "installation_jobs"
SET status = 'CANCELLED'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 2) Partial unique index — only one non-cancelled job per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS "installation_jobs_tenant_active_key"
  ON "installation_jobs" ("tenantId")
  WHERE status <> 'CANCELLED';
