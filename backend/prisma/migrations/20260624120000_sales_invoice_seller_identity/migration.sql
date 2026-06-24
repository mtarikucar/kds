-- Sales-invoice seller (issuer) identity snapshot.
--
-- AccountingSettings "Company Info" (companyName / companyTaxId /
-- companyTaxOffice / companyAddress / companyPhone / companyEmail) was
-- collected + persisted but never placed on any generated SalesInvoice nor
-- in the provider-sync payload — the operator's invoice issuer identity was
-- write-only. These six nullable columns snapshot that identity onto each
-- invoice at build time so the UBL-TR AccountingSupplierParty block can be
-- emitted and the seller appears on the document. Snapshotted (not joined)
-- so the historical document stays stable if settings change later.
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sellerName"      TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sellerTaxId"     TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sellerTaxOffice" TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sellerAddress"   TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sellerPhone"     TEXT;
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "sellerEmail"     TEXT;
