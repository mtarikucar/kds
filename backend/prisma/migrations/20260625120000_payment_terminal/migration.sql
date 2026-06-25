-- Integrated card-payment-terminal: configured terminals + charge-attempt
-- ledger. Additive + idempotent (CREATE TABLE / CREATE INDEX IF NOT EXISTS).
-- Loose-id design (no FK constraints) mirrors fiscal_devices; integrity is
-- enforced in PaymentTerminalService. Real charging is gated by
-- activationState (only ACTIVE moves money; SIMULATOR is test-only).

CREATE TABLE IF NOT EXISTS "payment_terminals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "providerId" TEXT NOT NULL,
    "deviceId" TEXT,
    "serial" TEXT NOT NULL,
    "model" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'offline',
    "activationState" TEXT NOT NULL DEFAULT 'CONFIGURED_NOT_ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terminals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payment_terminal_charges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "orderId" TEXT NOT NULL,
    "terminalRecordId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "deviceCommandId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvalCode" TEXT,
    "rrn" TEXT,
    "cardBrand" TEXT,
    "maskedPan" TEXT,
    "fiscalNo" TEXT,
    "paymentId" TEXT,
    "error" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_terminal_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_terminals_tenantId_providerId_serial_key" ON "payment_terminals"("tenantId", "providerId", "serial");
CREATE INDEX IF NOT EXISTS "payment_terminals_tenantId_branchId_status_idx" ON "payment_terminals"("tenantId", "branchId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "payment_terminal_charges_tenantId_idempotencyKey_key" ON "payment_terminal_charges"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "payment_terminal_charges_orderId_status_idx" ON "payment_terminal_charges"("orderId", "status");
CREATE INDEX IF NOT EXISTS "payment_terminal_charges_tenantId_status_createdAt_idx" ON "payment_terminal_charges"("tenantId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "payment_terminal_charges_deviceCommandId_idx" ON "payment_terminal_charges"("deviceCommandId");
