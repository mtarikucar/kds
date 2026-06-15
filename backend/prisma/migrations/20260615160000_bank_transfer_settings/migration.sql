-- Platform-level bank account for manual bank-transfer (havale/EFT) subscription
-- payments. Singleton table (one row, id='default'), superadmin-edited. The
-- payment/subscription rows reuse the existing subscription_payments table with
-- paymentProvider='BANK_TRANSFER' + paymentMethod='bank_transfer', so no schema
-- change is needed there.
CREATE TABLE IF NOT EXISTS "bank_transfer_settings" (
  "id"             TEXT NOT NULL DEFAULT 'default',
  "enabled"        BOOLEAN NOT NULL DEFAULT false,
  "bankName"       TEXT,
  "accountHolder"  TEXT,
  "iban"           TEXT,
  "instructions"   TEXT,
  "updatedByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_transfer_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row (disabled until the superadmin fills in the details).
INSERT INTO "bank_transfer_settings" ("id", "enabled")
VALUES ('default', false)
ON CONFLICT ("id") DO NOTHING;
