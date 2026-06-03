-- v2.8.98 P3b — PendingSelfPayment.requestHash dedup column
--
-- Deterministic SHA256-derived hash over (sessionId, sorted items,
-- amount, customer phone). The createPayIntent service checks for an
-- existing PENDING intent with the same hash before minting a fresh
-- PayTR session, so a customer's accidental double-tap on the pay
-- button doesn't open two parallel checkouts.
--
-- Backwards compat: nullable, no backfill — pre-existing rows stay
-- as `null` and the dedup check just doesn't fire for them.

ALTER TABLE "pending_self_payments"
  ADD COLUMN "requestHash" TEXT;

CREATE INDEX IF NOT EXISTS "pending_self_payments_tenantId_status_requestHash_idx"
  ON "pending_self_payments" ("tenantId", "status", "requestHash");
