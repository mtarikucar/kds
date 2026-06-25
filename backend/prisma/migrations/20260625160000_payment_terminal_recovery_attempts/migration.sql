-- Payment-terminal P4: reconciliation. Bound the recovery sweep so an
-- APPROVED-but-un-recordable charge can't be retried forever — after a cap it
-- is parked in NEEDS_REVIEW for operator reconciliation. Idempotent (safe to
-- re-run on the deploy baseline pipeline).
ALTER TABLE "payment_terminal_charges"
  ADD COLUMN IF NOT EXISTS "recoveryAttempts" INTEGER NOT NULL DEFAULT 0;
