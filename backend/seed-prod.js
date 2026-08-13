/* eslint-disable no-console */
/* ==========================================================================
 * KULLANILMIYOR / EMEKLİ — BU DOSYAYI ÇALIŞTIRMAYIN.
 * RETIRED — DO NOT RUN. This script is a tombstone; it refuses to execute.
 * ==========================================================================
 *
 * Nothing in the repository references `seed-prod.js`: no npm script, no
 * Dockerfile, no compose file, no CI workflow, no ops script, no doc.
 * (`git grep seed-prod` returns nothing but this file.) It was a one-off
 * bootstrap helper from the very first deploy and has been dead since.
 *
 * WHY IT IS NOT MERELY DEAD BUT DANGEROUS
 *
 * It was written against a product that no longer exists and a schema that
 * no longer accepts it, and — worse — the two halves fail in the wrong
 * order. The writes are not wrapped in a transaction, so the parts that
 * still "work" commit before the parts that crash:
 *
 *   1. It upserted FREE ($0) and BASIC ($29.99/mo, trialDays 14) rows into
 *      `subscription_plans` with `isActive: true`, and `isPublic` defaults
 *      to true in the schema. That is exactly the filter
 *      `SubscriptionService.getAvailablePlans` selects on, and it is served
 *      by the PUBLIC route `GET /subscriptions/plans`. Running this against
 *      a live database would republish a retired, USD-denominated, monthly,
 *      trial-bearing price list on the public pricing surface — undoing
 *      `20260811120000_free_core`, which switched those flags off precisely
 *      so the endpoint would stop advertising tiers.
 *   2. Only THEN does it hit the schema drift and abort: `table.createMany`
 *      omits the required `Table.branchId` (v3.0.0 strict branch scope), and
 *      the WAITER/KITCHEN users it creates violate the DB CHECK constraint
 *      that requires a `primaryBranchId` for hard-restricted roles. It also
 *      echoes working admin credentials to stdout.
 *
 * So the failure mode is "corrupt the price list, then crash" — the worst
 * possible ordering. Hence the hard refusal below rather than a comment
 * asking nicely.
 *
 * WHAT THE PRODUCT ACTUALLY IS NOW (2026-08-11 à-la-carte release)
 *
 * There are no plans, no tiers and no trials. The core is free and
 * unlimited for every tenant; paid capability is bought one annual product
 * at a time behind an annual licence. Sources of truth:
 *
 *   free core → backend/src/modules/entitlements/free-baseline.const.ts
 *   pricing   → backend/src/modules/marketplace/alacarte-catalog.const.ts
 *   history   → backend/src/common/constants/subscription-plans.const.ts
 *
 * WHAT TO RUN INSTEAD
 *
 *   local dev fixture   npm run prisma:seed      (backend/prisma/seed.ts)
 *   e2e demo tenant     npm run seed:demo        (backend/prisma/seed-demo.ts)
 *   marketplace catalog npm run seed:marketplace (backend/prisma/seeds/…)
 *   platform users      npx ts-node prisma/seed-platform-users.ts
 *
 * None of them seed a plan catalogue into a fresh database, and none of
 * them need this file. Delete it whenever someone is confident enough to
 * press the button; until then it stays as a signpost so nobody rediscovers
 * the original and runs it.
 * ========================================================================== */

console.error(
  [
    "",
    "  seed-prod.js is RETIRED and refuses to run.",
    "",
    "  It seeded a subscription-plan catalogue (FREE / BASIC, USD, monthly,",
    "  14-day trial) that the product retired on 2026-08-11. Running it would",
    "  have republished those rows on the public GET /subscriptions/plans",
    "  endpoint and then crashed on the current schema. The core product is",
    "  free and unlimited; paid capability is per-module and annual.",
    "",
    "  Use instead:",
    "    npm run prisma:seed       # local dev fixture (prisma/seed.ts)",
    "    npm run seed:demo         # e2e demo tenant  (prisma/seed-demo.ts)",
    "    npm run seed:marketplace  # à-la-carte product catalogue",
    "",
    "  See the header comment in this file for the full rationale.",
    "",
  ].join("\n"),
);

process.exit(1);
