-- HummyTummy Phase 7: provider-neutral fiscal devices, receipts, and day closes.

CREATE TABLE "fiscal_devices" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "branchId"     TEXT,
  "providerId"   TEXT NOT NULL,
  "deviceId"     TEXT,
  "serial"       TEXT NOT NULL,
  "model"        TEXT,
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"       TEXT NOT NULL DEFAULT 'offline',
  "lastSeenAt"   TIMESTAMP(3),
  "config"       JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_devices_tenantId_providerId_serial_key"
  ON "fiscal_devices" ("tenantId", "providerId", "serial");
CREATE INDEX "fiscal_devices_tenantId_branchId_status_idx"
  ON "fiscal_devices" ("tenantId", "branchId", "status");

CREATE TABLE "fiscal_receipts" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "orderId"        TEXT,
  "fiscalDeviceId" TEXT NOT NULL,
  "providerId"     TEXT NOT NULL,
  "fiscalNo"       TEXT,
  "fiscalZNo"      TEXT,
  "issuedAt"       TIMESTAMP(3),
  "totalCents"     INTEGER NOT NULL,
  "currency"       TEXT NOT NULL DEFAULT 'TRY',
  "vatBreakdown"   JSONB NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'queued',
  "idempotencyKey" TEXT NOT NULL,
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  "lastError"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fiscal_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fiscal_receipts_tenantId_idempotencyKey_key"
  ON "fiscal_receipts" ("tenantId", "idempotencyKey");
CREATE INDEX "fiscal_receipts_orderId_idx" ON "fiscal_receipts" ("orderId");
CREATE INDEX "fiscal_receipts_fiscalDeviceId_issuedAt_idx"
  ON "fiscal_receipts" ("fiscalDeviceId", "issuedAt");

ALTER TABLE "fiscal_receipts" ADD CONSTRAINT "fiscal_receipts_fiscalDeviceId_fkey"
  FOREIGN KEY ("fiscalDeviceId") REFERENCES "fiscal_devices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "fiscal_receipt_items" (
  "id"              TEXT NOT NULL,
  "fiscalReceiptId" TEXT NOT NULL,
  "lineNo"          INTEGER NOT NULL,
  "productCode"     TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "qty"             DECIMAL(10,3) NOT NULL,
  "unitPriceCents"  INTEGER NOT NULL,
  "vatRate"         INTEGER NOT NULL,
  "vatGroup"        TEXT,
  "discountCents"   INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "fiscal_receipt_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_receipt_items_fiscalReceiptId_lineNo_idx"
  ON "fiscal_receipt_items" ("fiscalReceiptId", "lineNo");

ALTER TABLE "fiscal_receipt_items" ADD CONSTRAINT "fiscal_receipt_items_fiscalReceiptId_fkey"
  FOREIGN KEY ("fiscalReceiptId") REFERENCES "fiscal_receipts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fiscal_day_closes" (
  "id"             TEXT NOT NULL,
  "tenantId"       TEXT NOT NULL,
  "fiscalDeviceId" TEXT NOT NULL,
  "zNo"            TEXT,
  "openedAt"       TIMESTAMP(3),
  "closedAt"       TIMESTAMP(3),
  "totals"         JSONB NOT NULL,
  CONSTRAINT "fiscal_day_closes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fiscal_day_closes_tenantId_closedAt_idx"
  ON "fiscal_day_closes" ("tenantId", "closedAt");
