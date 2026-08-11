-- Rollback for credits_ledger_migration.
--
-- Recreates ai_generation_usage exactly as 20260715070000 defined it and
-- refills it from the credit ledger rows that came from it — matched on
-- refType='media_job' OR a null ref, and on the three AI kinds, so SMS
-- consumption (which only exists in the new world) is correctly left behind.
--
-- Ids are preserved in both directions, so a round trip is lossless: a tenant
-- who had spent 40 units still shows 40 spent afterwards.

CREATE TABLE IF NOT EXISTS "ai_generation_usage" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "units"     INTEGER NOT NULL DEFAULT 1,
  "jobId"     TEXT,
  "voided"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_generation_usage_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_generation_usage_tenantId_fkey'
  ) THEN
    ALTER TABLE "ai_generation_usage"
      ADD CONSTRAINT "ai_generation_usage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ai_generation_usage_tenantId_kind_createdAt_idx"
  ON "ai_generation_usage"("tenantId", "kind", "createdAt");
CREATE INDEX IF NOT EXISTS "ai_generation_usage_jobId_idx"
  ON "ai_generation_usage"("jobId");

INSERT INTO "ai_generation_usage"
  ("id", "tenantId", "kind", "units", "jobId", "voided", "createdAt")
SELECT c."id", c."tenantId", c."kind", c."units", c."refId", c."voided", c."createdAt"
  FROM "credit_ledger" c
 WHERE c."kind" IN ('PHOTO', 'VIDEO', 'MODEL3D')
   AND (c."refType" = 'media_job' OR c."refType" IS NULL)
   AND NOT EXISTS (
     SELECT 1 FROM "ai_generation_usage" a WHERE a."id" = c."id"
   );

DELETE FROM "credit_ledger"
 WHERE "kind" IN ('PHOTO', 'VIDEO', 'MODEL3D')
   AND ("refType" = 'media_job' OR "refType" IS NULL);
