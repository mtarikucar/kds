-- Rollback for hardware_drop_fake_compliance_placeholders. Restores the
-- three placeholder fields — but ONLY on rows that are (a) in the exact
-- same 24-SKU allowlist the up migration used AND (b) still show EXACTLY
-- the post-up signature: `invoiceIssued: true` present and none of the
-- three removed keys present. Both guards matter: the SKU allowlist keeps
-- this from ever touching an unrelated row that legitimately carries the
-- same minimal `{ invoiceIssued: true }` default under the fixed seed (see
-- migration.sql's comment), and the post-up-signature guard keeps it from
-- clobbering any of these 24 rows an admin has since populated with real
-- compliance docs. Idempotent.
UPDATE "hardware_products"
SET "complianceDocs" = "complianceDocs" || jsonb_build_object(
      'warrantyCertUrl', '/docs/garanti-belgesi.pdf',
      'returnTermsUrl', '/docs/iade-ve-cayma-sartlari.pdf',
      'serviceInfo', 'Yetkili teknik servis üzerinden — destek hattı: 0850 000 00 00'
    )
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
  AND "complianceDocs" ->> 'invoiceIssued' = 'true'
  AND NOT ("complianceDocs" ? 'warrantyCertUrl')
  AND NOT ("complianceDocs" ? 'returnTermsUrl')
  AND NOT ("complianceDocs" ? 'serviceInfo');
