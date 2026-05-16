-- Tenant-owner toggle for customer self-pay (QR-menu PayTR flow).
-- Default false: opt-in. The backend region check (TURKEY-only) is
-- a hard gate; this column is the operator's explicit consent.

ALTER TABLE "pos_settings"
  ADD COLUMN "enableCustomerSelfPay" BOOLEAN NOT NULL DEFAULT false;
