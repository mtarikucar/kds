-- Rollback for hardware_drop_rent_offering. Restores the pre-migration
-- rentalMonthlyCents values, but ONLY for rows that still show NULL (i.e.
-- nothing — no admin edit — has set a different value since the up ran).
-- Idempotent — a safe no-op once already reverted or once an admin has set
-- their own rentalMonthlyCents value on either row.
UPDATE "hardware_products"
SET "rentalMonthlyCents" = 9900
WHERE "sku" = 'hummybox-lite'
  AND "rentalMonthlyCents" IS NULL;

UPDATE "hardware_products"
SET "rentalMonthlyCents" = 19900
WHERE "sku" = 'hummybox-pro'
  AND "rentalMonthlyCents" IS NULL;
