-- PO approval gate: threshold on settings + approval audit on the PO.
ALTER TABLE "stock_settings" ADD COLUMN "poApprovalThreshold" DECIMAL(12,2);
ALTER TABLE "purchase_orders" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "approvedAt" TIMESTAMP(3);
