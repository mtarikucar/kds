-- Rollback for hardware_recategorize_ingenico_pos_terminal. Mirrors the up
-- in reverse order (compat, then saleMode, then category) so each guard
-- still sees the state it expects. Only reverts rows that still show the
-- exact untouched post-up signature — a row an admin has since edited
-- (different saleMode, different compat, or already-reverted category) is
-- left alone. Idempotent.
UPDATE "hardware_products"
SET "compat" = "compat" || jsonb_build_object('gibCertified', true)
WHERE "sku" = 'yazarkasa-ingenico-move5000f'
  AND "category" = 'pos_terminal'
  AND NOT ("compat" ? 'gibCertified');

UPDATE "hardware_products"
SET "saleMode" = 'QUOTE_ONLY'
WHERE "sku" = 'yazarkasa-ingenico-move5000f'
  AND "category" = 'pos_terminal'
  AND "saleMode" = 'PARTNER_REDIRECT';

UPDATE "hardware_products"
SET "category" = 'yazarkasa'
WHERE "sku" = 'yazarkasa-ingenico-move5000f'
  AND "category" = 'pos_terminal';
