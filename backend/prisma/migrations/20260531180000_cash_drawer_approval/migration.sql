-- v2.8.98 P3a — CashDrawerMovement manager-approval audit trail
--
-- CASH_OUT and ADJUSTMENT movements move money outside of a sale flow
-- and need a second pair of eyes. The audit trail columns added here:
--   - approvalStatus  ('DRAFT' | 'APPROVED' | 'REJECTED')
--   - approvedById    FK to users.id, nullable, SetNull on user delete
--   - approvedAt      timestamp
--   - rejectionReason free text
--
-- Existing rows default to APPROVED so historical data still reconciles
-- (we have no signal to retroactively flag them as needing approval).
-- New CASH_OUT / ADJUSTMENT rows land DRAFT and the service requires a
-- separate APPROVE call before they participate in the cash drawer
-- reconciliation.

ALTER TABLE "cash_drawer_movements"
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "approvedById" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "rejectionReason" TEXT;

ALTER TABLE "cash_drawer_movements"
  ADD CONSTRAINT "cash_drawer_movements_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cash_drawer_movements_tenantId_approvalStatus_idx"
  ON "cash_drawer_movements" ("tenantId", "approvalStatus");
