-- v2.8.87 — rich product detail + service catalog.
--
-- Two nullable JSON columns on hardware_products:
--   details      — structured rich copy for the product/service detail page
--                  (includes, requirements, faq, steps, videoUrl, gallery).
--                  Per-locale variants supported via { tr: {...}, en: {...} }.
--   serviceMeta  — service-only metadata (durationHours, geoCoverage,
--                  requiresBranch, serviceType: 'onsite'|'remote'|'consultation').
--                  Read at checkout-provision time to decide whether to mint
--                  an InstallationRequest.
--
-- The HardwareProduct.category text column also gains 'service' as a valid
-- value at the application/DTO layer — no schema constraint needed (free-text
-- category column predates the enum-tighten).
--
-- Both columns nullable, no backfill required. Rolls forward cleanly on
-- staging + prod.
ALTER TABLE "hardware_products"
  ADD COLUMN "details" JSONB,
  ADD COLUMN "serviceMeta" JSONB;
