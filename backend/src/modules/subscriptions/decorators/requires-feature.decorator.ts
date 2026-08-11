import { PlanFeature } from "../../../common/constants/subscription.enum";
import { RequireEntitlement } from "../../entitlements/require-entitlement.decorator";

/** @deprecated Kept only as the metadata key some old specs assert on. */
export const REQUIRED_FEATURES_KEY = "requiredFeatures";

/**
 * Gate a route on one or more capability flags.
 *
 * v3.3.0: this is now a thin ALIAS over `@RequireEntitlement`. The mapping is
 * an identity — `PlanFeature.ADVANCED_REPORTS` is already the string
 * `"advancedReports"`, which prefixed is the engine key
 * `"feature.advancedReports"` — so re-aliasing migrated all 82 call sites
 * across ~40 controllers by editing this one file.
 *
 * Rewriting those sites by hand was the obvious alternative and the wrong one:
 * ~1,500 lines of mechanical diff through stock-management, reports,
 * analytics, accounting, menu, personnel, device-mesh, partner and webhooks —
 * modules with no relationship to billing — would have conflicted with every
 * branch in flight and buried the one genuinely risky change (the projector
 * rewrite) in noise.
 *
 * `entitlement-keys.spec.ts` pins the identity between the enum's values and
 * the key vocabulary, so the alias cannot silently start resolving to a key
 * nothing grants.
 */
export const RequiresFeature = (...features: PlanFeature[]) =>
  RequireEntitlement(...features.map((f) => ({ feature: `feature.${f}` })));
