-- v3.0.1 round-4 audit fix — hardware quote-request leads
-- (source=HARDWARE_QUOTE) need to preserve (a) which tenant requested
-- the quote and (b) a frozen snapshot of the catalog row + qty at
-- request time, so the marketing rep retains the original context
-- even if the admin later renames/archives the SKU.
--
-- Both columns are nullable so the migration is additive against
-- existing leads (every legacy non-HARDWARE_QUOTE row stays NULL).
-- `originTenantId` is a soft-FK string with no Postgres FK — marketing
-- decoupling Phase 5 set the policy that marketing-owned tables never
-- hold a hard FK into core (and vice versa); the index lets us still
-- query "all leads from tenant X" without a sequential scan.

ALTER TABLE "leads"
  ADD COLUMN "productSnapshot" JSONB,
  ADD COLUMN "originTenantId" TEXT;

CREATE INDEX IF NOT EXISTS "leads_originTenantId_idx"
  ON "leads" ("originTenantId");
