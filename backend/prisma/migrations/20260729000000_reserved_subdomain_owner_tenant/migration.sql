-- @doctor:idempotent verified=ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS; no data rows touched
-- Ownership stamp for quarantined subdomains: records WHICH tenant released
-- the name, so that tenant can reclaim its own subdomain (undo an accidental
-- rename that would otherwise break printed QR codes for the full 90-day
-- quarantine) while every other tenant stays blocked for the whole window.
-- Nullable on purpose: rows written before this migration have no owner and
-- keep the old block-everyone behaviour. Deliberately NO foreign key —
-- quarantine rows for DELETED tenants must outlive the tenant row.
ALTER TABLE "reserved_subdomains" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;

CREATE INDEX IF NOT EXISTS "reserved_subdomains_tenantId_idx"
  ON "reserved_subdomains"("tenantId");
