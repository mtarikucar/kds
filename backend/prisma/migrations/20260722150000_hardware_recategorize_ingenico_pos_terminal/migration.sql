-- Task 11 — Ingenico Move/5000F ("yazarkasa-ingenico-move5000f") is a
-- bank/PSP card-payment terminal (EMV L1/L2 + PCI PTS 5.x acquiring
-- device), not a YN ÖKC fiscal cash register. It was seeded with
-- category='yazarkasa', which CatalogService/QuoteService's
-- CATEGORY_DEFAULT_SALE_MODE map (create-hardware-product.dto.ts) defaults
-- to saleMode='QUOTE_ONLY' (the fiscal-dealer tier) — the wrong regulatory
-- bucket. The correct category is 'pos_terminal', which is a real,
-- implemented category (present in category-vocabulary.ts's
-- HARDWARE_CATEGORIES, so it passes the DTO's @IsIn gate and is fetchable
-- via GET /v1/catalog/categories) mapping to saleMode='PARTNER_REDIRECT'
-- (the bank/PSP-redirect tier — ProductDetailPage/StorePage both already
-- render a real CTA branch for it).
--
-- Three separate, narrowly-scoped statements so each can be reverted
-- independently and none clobbers a value an admin may have deliberately
-- set since the original (buggy) seed ran:
--   1. category — pure metadata correction, always safe to apply once.
--   2. saleMode — only flipped if it still shows the untouched buggy
--      default (QUOTE_ONLY); an admin who explicitly chose a different
--      saleMode after providing e.g. DIRECT_SALE compliance docs is left
--      alone.
--   3. compat.gibCertified — cleared only while still `true` (the
--      untouched seed default). GİB's YN ÖKC onay listesi doesn't apply to
--      a bank POS terminal, so this claim was self-contradictory once
--      recategorized. `invoiceIssued`-style ambiguity applies here too (no
--      audit trail distinguishes "seed default true" from "admin
--      re-affirmed true") — accepted, same risk class as Task 4/5.
UPDATE "hardware_products"
SET "category" = 'pos_terminal'
WHERE "sku" = 'yazarkasa-ingenico-move5000f'
  AND "category" = 'yazarkasa';

UPDATE "hardware_products"
SET "saleMode" = 'PARTNER_REDIRECT'
WHERE "sku" = 'yazarkasa-ingenico-move5000f'
  AND "category" = 'pos_terminal'
  AND "saleMode" = 'QUOTE_ONLY';

UPDATE "hardware_products"
SET "compat" = "compat" - 'gibCertified'
WHERE "sku" = 'yazarkasa-ingenico-move5000f'
  AND "compat" ->> 'gibCertified' = 'true';
