import { SetMetadata } from "@nestjs/common";

export const REQUIRE_ENTITLEMENT_KEY = "requireEntitlement";

/**
 * One declarative way to gate a route on the entitlement engine.
 *
 * Usage:
 *   @RequireEntitlement('feature.kds')                        // boolean feature
 *   @RequireEntitlement({ feature: 'feature.advancedReports' })
 *   @RequireEntitlement({ limit: 'limit.maxTables', usage: (req) => countTables(req) })
 *   @RequireEntitlement({ integration: 'integration.delivery', provider: 'yemeksepeti' })
 *
 * v3.3.0: this is now the ONLY entitlement decorator. `@RequiresFeature` and
 * `@RequiresIntegration` are thin aliases over it (see their files), which is
 * what let 85 call sites across ~40 controllers migrate without a single edit
 * — the legacy decorators' arguments were already these keys verbatim.
 * `@RequiresPlan` and `@CheckLimit` are gone with plans and numeric limits.
 */
export type EntitlementRequirement =
  | string
  | { feature: string }
  | { limit: string; usage: number | ((req: any) => number | Promise<number>) }
  /**
   * `provider` is OPTIONAL: omitting it means "this domain must have at least
   * one vendor", which is what `@RequiresIntegration('fiscal')` has always
   * meant. The alias in requires-integration.decorator depends on it.
   */
  | { integration: string; provider?: string };

export const RequireEntitlement = (...reqs: EntitlementRequirement[]) =>
  SetMetadata(REQUIRE_ENTITLEMENT_KEY, reqs);
