import { RequireEntitlement } from "../../entitlements/require-entitlement.decorator";

/** @deprecated Kept only as the metadata key some old specs assert on. */
export const REQUIRED_INTEGRATIONS_KEY = "requiredIntegrations";

/**
 * Gate a route on owning at least one vendor in an integration domain.
 *
 *   - `@RequiresIntegration('fiscal')` on `/v1/fiscal/*` — open to tenants who
 *     own `fiscal_hugin`, `fiscal_efatura`, or any future fiscal product.
 *   - `@RequiresIntegration('delivery')` on `/v1/delivery-platforms/*`.
 *   - `@RequiresIntegration('caller')`, `('sms')`, `('accounting')`.
 *
 * v3.3.0: a thin ALIAS over `@RequireEntitlement`, like `@RequiresFeature`.
 * Note the requirement is emitted WITHOUT a `provider` — that is what makes
 * `EntitlementGuard` apply "the domain has ≥1 vendor" rather than "this exact
 * vendor is permitted". Emitting a provider here would 403 every one of these
 * routes for tenants who own a different vendor in the same domain.
 *
 * Multiple domains are AND'd; the engine does not model OR at the decorator
 * layer.
 */
export const RequiresIntegration = (...domains: string[]) =>
  RequireEntitlement(
    ...domains.map((d) => ({ integration: `integration.${d}` })),
  );
