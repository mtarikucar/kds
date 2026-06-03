-- Phase 1 marketing decoupling — provisioning ledger.
--
-- CORE-owned idempotency + reconciliation anchor for the Lead → Customer
-- conversion (business event #1). One row per converted lead. Written inside
-- the same transaction that creates the tenant + admin user + subscription, so
-- a retried or concurrent conversion converges on the existing tenant instead
-- of minting a second one (unique on leadId AND idempotencyKey).
--
-- All columns are plain SOFT references (no FK): leadId points at the
-- marketing-owned `leads` table, and tenant/user/subscription must never
-- cascade-delete this audit row. This keeps the ledger valid after the Phase-5
-- physical DB split.
CREATE TABLE "tenant_provisioning_log" (
  "id"             TEXT NOT NULL,
  "leadId"         TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "adminUserId"    TEXT NOT NULL,
  "subscriptionId" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_provisioning_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_provisioning_log_leadId_key" ON "tenant_provisioning_log"("leadId");
CREATE UNIQUE INDEX "tenant_provisioning_log_idempotencyKey_key" ON "tenant_provisioning_log"("idempotencyKey");
CREATE INDEX "tenant_provisioning_log_tenantId_idx" ON "tenant_provisioning_log"("tenantId");
