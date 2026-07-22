/**
 * Maps an integration *domain* (the bare name used in `integration.<domain>`
 * entitlement keys and in `@RequiresIntegration(<domain>)`) to the
 * plan-feature *bare name* (as used in `SubscriptionPlan` boolean columns /
 * `PlanFeature` enum / `feature.<name>` entitlement keys) that already
 * covers it.
 *
 * Why this exists (DEF-3): `PlanProjectorService.FEATURE_COLUMNS` only ever
 * projects `feature.*` grants for a tenant's plan — it never writes
 * `integration.*` grants (see plan-projector.service.ts's projection loop).
 * Meanwhile the delivery add-ons (`delivery_yemeksepeti` / `delivery_getir` /
 * `delivery_trendyol_yemek`) grant `integration.delivery: [<vendor>]`. Two
 * consumers need to know these are the SAME capability under two different
 * keys:
 *
 *  - `TenantMarketplaceService.isIncludedInEntitlements` (marketplace
 *    catalogue "already included in your plan" annotation) — without this
 *    map, a tenant whose PLAN includes delivery (feature.deliveryIntegration
 *    = true) sees the delivery add-on as purchasable, because the function
 *    only ever compared against `ent.integrations`, which the projector
 *    never populates for plan-sourced access.
 *  - `PlanFeatureGuard`'s `@RequiresIntegration` branch (route gating) —
 *    without this map, a tenant who *bought* the add-on
 *    (`integration.delivery=[yemeksepeti]`, no covering feature) fails any
 *    route gated on `feature.deliveryIntegration`, so the add-on they paid
 *    for unlocks nothing.
 *
 * Domains with NO entry here (fiscal, caller) have no plan-level feature
 * that stands in for the integration — a tenant only gets fiscal/caller
 * access by buying the corresponding add-on, so those domains stay purely
 * vendor-list-based (`ent.integrations['integration.<domain>']`), same as
 * before this map existed.
 *
 * Single source of truth: import this from BOTH consumers above instead of
 * hardcoding the domain↔feature pairing a second time.
 */
export const INTEGRATION_COVERED_BY_FEATURE: Readonly<Record<string, string>> =
  Object.freeze({
    delivery: "deliveryIntegration",
  });
