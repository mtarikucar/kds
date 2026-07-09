-- KDV tevkifatı (VAT withholding) on the sales invoice.
ALTER TABLE "sales_invoices" ADD COLUMN "withholdingTaxAmount" DECIMAL(10,2);
ALTER TABLE "sales_invoices" ADD COLUMN "withholdingCode" TEXT;
