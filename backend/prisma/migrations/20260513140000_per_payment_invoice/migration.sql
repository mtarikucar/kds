-- Per-payment SalesInvoice: progressive payment flow needs to issue
-- one fatura per customer (Turkish e-fatura compliance + correct
-- payment-method on each invoice). Drop the @unique on orderId so
-- multiple invoices can attach to the same order; add a nullable
-- paymentId column with a partial unique index for "one invoice per
-- payment" without blocking the NULL rows used by legacy order-level
-- invoices.

-- Drop the orderId unique constraint Prisma had generated.
DROP INDEX IF EXISTS "sales_invoices_orderId_key";

-- (The non-unique @@index on orderId from the schema is still in place;
--  Prisma named it sales_invoices_orderId_idx in an earlier migration.)

ALTER TABLE "sales_invoices"
  ADD COLUMN "paymentId" TEXT;

CREATE INDEX "sales_invoices_paymentId_idx" ON "sales_invoices"("paymentId");

-- Partial unique: at most one invoice per non-null paymentId. NULL
-- rows (order-level invoices) are unaffected.
CREATE UNIQUE INDEX "sales_invoices_paymentId_notnull_key"
  ON "sales_invoices"("paymentId")
  WHERE "paymentId" IS NOT NULL;

ALTER TABLE "sales_invoices"
  ADD CONSTRAINT "sales_invoices_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
