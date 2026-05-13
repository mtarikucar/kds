-- Customer self-pay (QR-menu PayTR flow): intent row created before
-- requesting a PayTR token, read by the webhook to drive payByItems
-- once the diner finishes 3DS. The "SP" merchantOid prefix routes
-- the webhook to the self-pay path; "SUB" stays subscription.

CREATE TABLE "pending_self_payments" (
  "id"              TEXT NOT NULL,
  "merchantOid"     TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "itemsByOrder"    JSONB NOT NULL,
  "amount"          DECIMAL(10,2) NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "failureReason"   TEXT,
  "paytrToken"      TEXT,
  "customerPhone"   TEXT,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt"     TIMESTAMP(3),

  CONSTRAINT "pending_self_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_self_payments_merchantOid_key" ON "pending_self_payments"("merchantOid");
CREATE INDEX "pending_self_payments_sessionId_idx" ON "pending_self_payments"("sessionId");
CREATE INDEX "pending_self_payments_tenantId_idx" ON "pending_self_payments"("tenantId");
CREATE INDEX "pending_self_payments_expiresAt_idx" ON "pending_self_payments"("expiresAt");

ALTER TABLE "pending_self_payments"
  ADD CONSTRAINT "pending_self_payments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
