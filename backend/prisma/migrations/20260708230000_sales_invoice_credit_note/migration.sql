-- Credit note (İade Faturası): a REFUND invoice links back to the original SALES.
ALTER TABLE "sales_invoices" ADD COLUMN "originalInvoiceId" TEXT;
CREATE INDEX "sales_invoices_originalInvoiceId_idx" ON "sales_invoices"("originalInvoiceId");
