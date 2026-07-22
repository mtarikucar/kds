-- Task 11 — remove the "rent" acquisition offering from the hardware
-- catalog FOR NOW. Approved decision: PayTR (the only payment rail wired
-- into checkout) charges a HardwareOrder ONCE — there is no recurring
-- monthly-billing rail behind "rent" at all. A tenant who chose "rent" on
-- hummybox-lite/hummybox-pro was charged the monthly figure exactly once
-- and then never billed again — the storefront silently promised a
-- subscription it could never actually deliver.
--
-- This is a deferral, not a deletion: the `rentalMonthlyCents` column, the
-- CreateHardwareProductDto field, and QuoteService's
-- `acquisition === 'rent'` branch (which still throws
-- "SKU ... is not available for rental" when unset) all stay — a future
-- project can re-offer rent once a real recurring-billing rail exists. This
-- migration + the paired seed-marketplace.ts edit just make sure the
-- catalog no longer OFFERS it today, so the storefront never sends
-- acquisition:'rent' in the first place.
--
-- Idempotent + scoped: only touches the exact two SKUs that ever carried a
-- rentalMonthlyCents value in the seed, and only while they still show the
-- untouched seed value — a row an admin has since re-priced for rent via
-- the backoffice CMS (a different, deliberately-chosen value) is left
-- alone, matching the Task 4/5 "never clobber an admin's explicit choice"
-- convention.
UPDATE "hardware_products"
SET "rentalMonthlyCents" = NULL
WHERE "sku" = 'hummybox-lite'
  AND "rentalMonthlyCents" = 9900;

UPDATE "hardware_products"
SET "rentalMonthlyCents" = NULL
WHERE "sku" = 'hummybox-pro'
  AND "rentalMonthlyCents" = 19900;
