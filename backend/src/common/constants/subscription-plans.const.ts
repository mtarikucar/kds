/**
 * Retired plan catalogue.
 *
 * HummyTummy sold tiered monthly plans (FREE/BASIC/PRO/BUSINESS) until the
 * à-la-carte series of 2026-08-11 retired the rail: `20260811120000_free_core`
 * deactivated every `subscription_plans` row and nulled every tenant's
 * `currentPlanId`, `20260811140000_retire_subscription_rail` dropped the
 * plan-change table, and `GET /subscriptions/plans` now returns an empty array
 * for good.
 *
 * The static PlanConfig table that used to live here went with it. It carried
 * ₺499 / ₺1.299 / ₺2.999 monthly prices and a 14-day trial that nothing
 * charges or grants any more, and it had outlived its last reader — a price
 * table no code consults is not documentation, it is a trap for whoever reads
 * it next and quotes those numbers to a customer.
 *
 * SOURCES OF TRUTH, if you came here looking for either:
 *   - pricing      → `src/modules/marketplace/alacarte-catalog.const.ts`
 *                    (annual licence, modules, integrations, capacity,
 *                    credits, services), shared by the seed, the catalog
 *                    migration and the invariant specs.
 *   - entitlements → `src/modules/entitlements/free-baseline.const.ts` plus
 *                    the projector over `TenantAddOn` rows.
 *
 * Only the -1 sentinel helper survives, because entitlement limit values
 * still use it.
 */

/** The -1 sentinel means "no cap" wherever a numeric limit is carried. */
export const isUnlimited = (limit: number): boolean => limit === -1;
