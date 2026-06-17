-- Stabilize all subscription/billing money to TRY.
--
-- The platform collects in Turkish Lira only: PayTR (the card processor) is
-- TRY-only and silently ignores the currency field, so a plan priced in a
-- foreign currency rendered e.g. "$199.99" on the storefront while PayTR
-- actually charged the same NUMBER in TL. The product decision is TRY-only,
-- so this migration brings the live data in line with the canonical TRY
-- catalog (prisma/seed.ts) and removes every stale foreign-currency value.
--
-- Idempotent: every statement is gated on `currency <> 'TRY'`, so re-running
-- after the data is clean is a no-op.

-- 1) Catalog plans → canonical TRY tier prices (matched by the unique name).
--    A foreign-currency Business plan ($199.99) becomes ₺2.999, etc.
UPDATE "subscription_plans" SET "currency" = 'TRY', "monthlyPrice" = 0,    "yearlyPrice" = 0     WHERE "name" = 'FREE'     AND "currency" <> 'TRY';
UPDATE "subscription_plans" SET "currency" = 'TRY', "monthlyPrice" = 499,  "yearlyPrice" = 4490  WHERE "name" = 'BASIC'    AND "currency" <> 'TRY';
UPDATE "subscription_plans" SET "currency" = 'TRY', "monthlyPrice" = 1299, "yearlyPrice" = 12990 WHERE "name" = 'PRO'      AND "currency" <> 'TRY';
UPDATE "subscription_plans" SET "currency" = 'TRY', "monthlyPrice" = 2999, "yearlyPrice" = 29990 WHERE "name" = 'BUSINESS' AND "currency" <> 'TRY';

-- Any other non-TRY plan (custom / superadmin-created) has no canonical TRY
-- mapping — flip the label only, keep the numeric price.
UPDATE "subscription_plans" SET "currency" = 'TRY'
WHERE "currency" <> 'TRY' AND "name" NOT IN ('FREE', 'BASIC', 'PRO', 'BUSINESS');

-- 2) Subscriptions on a re-priced plan → snap the stored amount to the plan's
--    TRY price for their billing cycle (the chosen "convert to current TRY
--    price" behaviour). The next renewal invoice then bills the correct TRY.
UPDATE "subscriptions" AS s
SET "currency" = 'TRY',
    "amount" = CASE WHEN s."billingCycle" = 'YEARLY' THEN p."yearlyPrice" ELSE p."monthlyPrice" END
FROM "subscription_plans" AS p
WHERE s."planId" = p."id" AND s."currency" <> 'TRY';

-- 3) Past payments + invoices → relabel to TRY WITHOUT rewriting amounts:
--    PayTR collected the stored number in lira, so the totals already reflect
--    what was actually charged — relabelling makes the record honest, not
--    inflated (e.g. a "$199.99" invoice becomes ₺199.99 = what was paid).
UPDATE "subscription_payments" SET "currency" = 'TRY' WHERE "currency" <> 'TRY';
UPDATE "invoices" SET "currency" = 'TRY' WHERE "currency" <> 'TRY';

-- 4) Marketplace add-ons → TRY label (priceCents kept as-is, same reasoning).
UPDATE "marketplace_addons" SET "currency" = 'TRY' WHERE "currency" <> 'TRY';

-- 5) Tenant display currency → TRY (POS / storefront / customer pages read it).
UPDATE "tenants" SET "currency" = 'TRY' WHERE "currency" <> 'TRY';
