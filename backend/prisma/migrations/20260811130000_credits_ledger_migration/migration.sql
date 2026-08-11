-- @doctor:idempotent verified=the INSERT ... SELECT is guarded by NOT EXISTS on the destination id, and the DROP is IF EXISTS. Re-running copies nothing and drops nothing that is already gone.
--
-- Credits (P4 of 9) — migrate the AI quota ledger into the credit ledger.
--
-- `ai_generation_usage` was a MONTHLY quota ledger: rows counted against a
-- per-calendar-month plan column. Credits are bought and valid until consumed,
-- so the same rows now mean "units already spent", counted against purchased
-- lots for all time rather than against a window.
--
-- The rows carry over one-for-one, ids included. That is what makes the
-- rollback honest: `down.sql` copies them back with the same ids, so a tenant
-- who had spent 40 of their allowance still shows 40 spent either way. The
-- refund machinery keeps working across the move because `voided` and the soft
-- job reference travel with the row.
--
-- No lots are minted here. Existing tenants' AI allowance came from a plan
-- column, and plans are retired — granting them a balance would be inventing
-- money. Anyone mid-flight gets credits the same way everyone else does: by
-- buying a pack, or by an operator comp (CreditService.grant).

-- ---------------------------------------------------------------------------
-- 1. Carry the consumption rows across.
-- ---------------------------------------------------------------------------
-- kind values are already identical (PHOTO | VIDEO | MODEL3D), which is why
-- the credit vocabulary reuses them — a remap here would be one more thing to
-- get wrong in both directions.
-- Guarded on the source table's existence: step 2 drops it, so an unguarded
-- re-run would be a hard error rather than the no-op it should be.
DO $$
BEGIN
  IF to_regclass('public.ai_generation_usage') IS NOT NULL THEN
    INSERT INTO "credit_ledger"
      ("id", "tenantId", "kind", "units", "lotId", "refType", "refId", "voided", "createdAt")
    SELECT
      u."id",
      u."tenantId",
      u."kind",
      u."units",
      NULL,
      CASE WHEN u."jobId" IS NULL THEN NULL ELSE 'media_job' END,
      u."jobId",
      u."voided",
      u."createdAt"
    FROM "ai_generation_usage" u
    WHERE NOT EXISTS (
      SELECT 1 FROM "credit_ledger" c WHERE c."id" = u."id"
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Retire the old table.
-- ---------------------------------------------------------------------------
-- Safe to drop: every row was just copied, MenuAiQuotaService no longer reads
-- it (it is now an adapter over CreditService), and the down recreates the
-- table and refills it from the same rows.
DROP TABLE IF EXISTS "ai_generation_usage";
