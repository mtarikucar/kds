import { SetMetadata } from "@nestjs/common";

export const REQUIRED_INTEGRATIONS_KEY = "requiredIntegrations";

/**
 * v2.8.88 — gate a route on the presence of at least one
 * integration grant for a given domain.
 *
 * Use cases:
 *   - `@RequiresIntegration('fiscal')` on `/v1/fiscal/*` routes —
 *     visible only to tenants who own `fiscal_hugin` / `fiscal_efatura`
 *     / similar add-ons.
 *   - `@RequiresIntegration('delivery')` on `/v1/delivery-platforms/*`
 *     routes (cross-checks with `feature.deliveryIntegration` so the
 *     plan-level grant works too).
 *   - `@RequiresIntegration('caller')` once a caller integration
 *     add-on family ships.
 *
 * Backing: `PlanFeatureGuard` (the same guard that handles
 * `@RequiresFeature` and `@CheckLimit`). The guard consults the
 * entitlement engine's resolved view, so plan grants + TenantAddOn
 * grants + admin overrides all count.
 *
 * Multiple domains are AND'd. To gate on "fiscal OR delivery" use a
 * single domain that's typed correctly upstream — the engine doesn't
 * model OR at the decorator layer.
 */
export const RequiresIntegration = (...domains: string[]) =>
  SetMetadata(REQUIRED_INTEGRATIONS_KEY, domains);
