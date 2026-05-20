-- Commission audit fields: who approved, who paid, append-only JSON
-- log of state transitions. All nullable so existing rows back-fill
-- as empty (no historical reconstruction).

ALTER TABLE "commissions" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "commissions" ADD COLUMN "paidById"     TEXT;
ALTER TABLE "commissions" ADD COLUMN "auditLog"     JSONB;
