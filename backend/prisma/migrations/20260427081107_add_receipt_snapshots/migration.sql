-- Add JSONB snapshot columns for reprintable receipts and kitchen tickets.
-- See backend/src/modules/orders/services/receipt-snapshot.builder.ts.
-- Both columns are nullable so the migration is trivially reversible
-- (no backfill needed; only new payments/orders populate them).

ALTER TABLE "payments" ADD COLUMN "receiptSnapshot" JSONB;
ALTER TABLE "orders" ADD COLUMN "kitchenTicketSnapshot" JSONB;
