-- Deterministic idempotency for paid hardware-order provisioning.
--
-- confirmAndProvision creates exactly one HardwareOrder per (tenantId, paymentRef).
-- Its pre-check (hardwareOrder.findFirst by paymentRef) runs OUTSIDE the
-- Serializable transaction, and the INSERT shape has no shared read predicate
-- for SSI to catch — so two concurrent PayTR settlements for the same ref could
-- both insert, double-provisioning hardware. This partial unique index makes the
-- loser fail with P2002 (mapped to a retryable 409) regardless of isolation.
--
-- Partial (WHERE paymentRef IS NOT NULL) so the operator-comp path (null ref)
-- is unconstrained, and a cart produces exactly one order per ref anyway.
CREATE UNIQUE INDEX IF NOT EXISTS "hardware_orders_tenantId_paymentRef_key"
  ON "hardware_orders" ("tenantId", "paymentRef")
  WHERE "paymentRef" IS NOT NULL;
