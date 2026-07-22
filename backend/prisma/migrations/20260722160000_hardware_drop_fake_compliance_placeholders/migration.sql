-- Task 11 — seed-marketplace.ts's SEED_DEFAULT_COMPLIANCE (stamped onto
-- every published DIRECT_SALE hardware/service row that never got a real
-- per-row complianceDocs override) used to carry three placeholders that
-- rendered, unfiltered, to real tenants on the product/service detail
-- page's "Yasal & Garanti" tab:
--   - warrantyCertUrl: "/docs/garanti-belgesi.pdf"        (file never existed)
--   - returnTermsUrl:  "/docs/iade-ve-cayma-sartlari.pdf" (file never existed)
--   - serviceInfo: "... destek hattı: 0850 000 00 00"     (fabricated phone number)
--
-- Removed rather than replaced — `invoiceIssued: true` (a real business
-- fact) is left in place and alone still satisfies
-- CatalogService.hasComplianceDocs (>=1 non-empty value), so the
-- DIRECT_SALE publish gate stays satisfied on every affected row.
--
-- Scoped by BOTH an explicit SKU allowlist (the exact 24 SKUs that resolved
-- to saleMode=DIRECT_SALE under the pre-fix seed and therefore could ever
-- have received SEED_DEFAULT_COMPLIANCE — every seeded hardware/service SKU
-- except the 3 fiscal/bank-POS ones, which get null complianceDocs) AND an
-- exact-value match on all three placeholder fields together. The SKU
-- allowlist matters here specifically because the fixed SEED_DEFAULT_
-- COMPLIANCE is now `{ invoiceIssued: true }` — the exact shape this
-- migration leaves behind — so a value-only match on "just invoiceIssued"
-- would also catch any OTHER unrelated row that happens to carry that same
-- minimal (and entirely legitimate, post-fix) default, on this row or any
-- future one. The allowlist keeps this migration's blast radius exactly
-- equal to "rows this bug could actually have touched". Any of these 24
-- rows an admin has since edited (even a single field) no longer matches
-- the exact-value guard and is left alone. Idempotent.
UPDATE "hardware_products"
SET "complianceDocs" = "complianceDocs" - 'warrantyCertUrl' - 'returnTermsUrl' - 'serviceInfo'
WHERE "sku" IN (
    'printer-epson-tm-t20iii-lan',
    'printer-epson-tm-t88vi-eth',
    'printer-star-tsp143iiibi',
    'kds-sunmi-d2s',
    'kds-penetek-15in-ip65',
    'tablet-sunmi-v2-pro',
    'tablet-samsung-tab-a9-plus',
    'scanner-honeywell-voyager-1450g',
    'scanner-zebra-ds2208',
    'caller-id-cidshow-cid602',
    'cash-drawer-afanda-lb405k',
    'hummybox-lite',
    'hummybox-pro',
    'install-yazarkasa-gib',
    'install-full-pos',
    'install-kds-only',
    'training-basic-4h',
    'training-advanced-8h',
    'integration-yemeksepeti',
    'integration-trendyol-yemek',
    'integration-efatura-setup',
    'menu-migration',
    'wifi-site-survey',
    'multibranch-rollout'
  )
  AND "complianceDocs" ->> 'warrantyCertUrl' = '/docs/garanti-belgesi.pdf'
  AND "complianceDocs" ->> 'returnTermsUrl' = '/docs/iade-ve-cayma-sartlari.pdf'
  AND "complianceDocs" ->> 'serviceInfo' = 'Yetkili teknik servis üzerinden — destek hattı: 0850 000 00 00';
