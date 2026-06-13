-- Track 1 branch-scope hardening — fiscal_receipts gain a branchId so a
-- multi-branch tenant's receipts isolate per branch. Additive + nullable:
-- legacy rows backfill from their issuing device (fiscal_devices.branchId),
-- which is the physical branch the receipt was issued at.
ALTER TABLE "fiscal_receipts" ADD COLUMN "branchId" TEXT;

UPDATE "fiscal_receipts" fr
SET "branchId" = fd."branchId"
FROM "fiscal_devices" fd
WHERE fr."fiscalDeviceId" = fd."id";

CREATE INDEX IF NOT EXISTS "fiscal_receipts_tenantId_branchId_status_idx"
  ON "fiscal_receipts" ("tenantId", "branchId", "status");
