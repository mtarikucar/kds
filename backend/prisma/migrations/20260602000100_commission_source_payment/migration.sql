-- Phase 1 / Step C marketing decoupling — settlement commissions move from a
-- direct call inside PayTR settlement (core) to a marketing-owned event
-- consumer (SettlementCommissionConsumer) that reacts to `payment.succeeded.v1`.
--
-- Under at-least-once in-process event delivery the consumer can be invoked
-- more than once for the same payment, so RENEWAL/UPSELL credits need an
-- idempotency key the old direct-call path didn't have (it relied on settlement
-- firing once). `sourcePaymentId` is that key. SIGNUP keeps its existing
-- (tenantId, type='SIGNUP') Serializable guard.
--
-- Soft reference (no FK): the payment row lives in the core context and must
-- not cascade into marketing commissions after the Phase-5 DB split.
ALTER TABLE "commissions" ADD COLUMN "sourcePaymentId" TEXT;

CREATE INDEX "commissions_sourcePaymentId_idx" ON "commissions"("sourcePaymentId");

-- Exactly-once per (payment, type). Partial so legacy rows (sourcePaymentId
-- NULL) and SIGNUP's own dedupe path are unaffected.
CREATE UNIQUE INDEX "commissions_sourcePaymentId_type_key"
  ON "commissions"("sourcePaymentId", "type")
  WHERE "sourcePaymentId" IS NOT NULL;
