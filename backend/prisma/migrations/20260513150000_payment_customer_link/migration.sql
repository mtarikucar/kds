-- Per-Payment customer link (progressive flow): each diner who pays
-- via payByItems can be linked to a Customer row, with CRM stats
-- bumped by THIS payment's amount only. Order.customerId stays
-- "primary customer on the bill" for legacy display.

ALTER TABLE "payments"
  ADD COLUMN "customerId" TEXT;

CREATE INDEX "payments_customerId_idx" ON "payments"("customerId");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
