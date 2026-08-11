import { featureKey, limitKey } from "./entitlement-keys.const";

/** Projection source for the free core. One row per key, per tenant. */
export const FREE_BASELINE_SOURCE = "free:baseline";

/**
 * The free core — granted to EVERY tenant, unconditionally, forever.
 *
 * Expressed as data rather than as a guard-level allowlist for four reasons,
 * each of which is a bug avoided:
 *
 *  1. The engine folds `feature.*` with OR, so the baseline composes with
 *     paid grants automatically. There is no precedence rule to get wrong.
 *  2. `-1` DOMINATES the `limit.*` SUM fold. Any stale `plan:*` row that
 *     outlives the migration folds in harmlessly instead of capping a tenant
 *     who is supposed to be unlimited — the failure mode is "still free",
 *     not "suddenly limited".
 *  3. The SPA reads the same folded entitlement set the guards do, so a
 *     baseline in the data needs zero frontend special-casing.
 *  4. Ops can still suppress a baseline capability for one tenant via an
 *     `override:admin` `{__replace:false}` grant when handling abuse.
 *
 * Note the deliberate split on branches: `multiLocation` (the branch hub, the
 * branch picker, the switcher UI) is FREE, while `limit.maxBranches` is 1.
 * Multi-branch is not the paid thing — the second branch is. That is exactly
 * why `extra_branch` grants both keys.
 */
export const FREE_BASELINE_GRANTS: Record<string, boolean | number> = {
  // --- free capabilities ---
  [featureKey("posAccess")]: true,
  [featureKey("kdsIntegration")]: true,
  [featureKey("customBranding")]: true,
  [featureKey("multiLocation")]: true,

  // --- retired caps, now unlimited ---
  // These keys survive only so the -1 sentinel can dominate any stale
  // plan-sourced grant. Nothing enforces them any more; the decorators that
  // did were deleted along with @CheckLimit.
  [limitKey("maxUsers")]: -1,
  [limitKey("maxTables")]: -1,
  [limitKey("maxProducts")]: -1,
  [limitKey("maxCategories")]: -1,
  [limitKey("maxMonthlyOrders")]: -1,

  // --- the one surviving numeric limit ---
  // 1 free branch; each purchased `extra_branch` unit SUMs +1 on top.
  [limitKey("maxBranches")]: 1,
};

/**
 * Feature keys the free core does NOT grant. Derived rather than hand-listed
 * so adding a feature to the vocabulary without deciding whether it is free
 * cannot silently make it free.
 */
export function isFreeBaselineFeature(key: string): boolean {
  return FREE_BASELINE_GRANTS[key] === true;
}
