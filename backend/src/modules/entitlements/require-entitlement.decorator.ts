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
 * The new decorator coexists with the legacy @RequiresFeature / @RequiresPlan
 * / @CheckLimit decorators during the migration. Existing routes keep working;
 * new routes should use this one. Phase 1 is "build the seam"; later phases
 * port the legacy decorators over (search for usages and swap one-by-one).
 */
export type EntitlementRequirement =
  | string
  | { feature: string }
  | { limit: string; usage: number | ((req: any) => number | Promise<number>) }
  | { integration: string; provider: string };

export const RequireEntitlement = (...reqs: EntitlementRequirement[]) =>
  SetMetadata(REQUIRE_ENTITLEMENT_KEY, reqs);
