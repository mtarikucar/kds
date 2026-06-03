import {
  classify,
  EMPTY_ENTITLEMENT_SET,
  EntitlementGrant,
  EntitlementSet,
} from "./entitlement.types";

// Pure, side-effect-free fold from a list of grant rows into a single
// EntitlementSet ready for guards and the UI. Kept deliberately framework-free
// so the same code can power the API guard, a UI mirror in shared-types, and
// unit tests without spinning up Nest.
//
// Combine rules:
//   feature.*       boolean     OR    (any grant enabling → enabled)
//   limit.*         number      SUM
//   integration.*   string[]    UNION
//
// Override precedence is encoded by source ordering: callers pass grants
// pre-filtered by `now` (expiry handled upstream) and the engine never looks
// at `source` for combination — but `override:*` grants for limit/integration
// REPLACE the running value when their value is wrapped as `{ replace: T }`.
// Keeping the override semantics explicit (a wrapper object) means the fold
// stays pure and the projector decides what overriding means, not the engine.

interface ReplaceWrapper<T> {
  __replace: T;
}

function isReplace<T>(v: unknown): v is ReplaceWrapper<T> {
  return typeof v === "object" && v !== null && "__replace" in (v as object);
}

export function fold(
  grants: ReadonlyArray<EntitlementGrant>,
  now: Date = new Date(),
): EntitlementSet {
  if (grants.length === 0)
    return { ...EMPTY_ENTITLEMENT_SET, computedAt: now.toISOString() };

  const features: Record<string, boolean> = {};
  const limits: Record<string, number> = {};
  const integrations: Record<string, Set<string>> = {};
  // Replacement values applied AFTER the additive pass so order of input
  // doesn't matter.
  const limitReplacements: Record<string, number> = {};
  const integrationReplacements: Record<string, string[]> = {};
  const featureReplacements: Record<string, boolean> = {};

  for (const g of grants) {
    if (g.validUntil && g.validUntil.getTime() < now.getTime()) continue;

    const kind = classify(g.key);
    if (!kind) continue;

    if (kind === "feature") {
      if (isReplace<boolean>(g.value)) {
        featureReplacements[g.key] = !!g.value.__replace;
        continue;
      }
      // Anything truthy enables; once true, stays true.
      features[g.key] = features[g.key] || Boolean(g.value);
    } else if (kind === "limit") {
      if (isReplace<number>(g.value)) {
        limitReplacements[g.key] = Number(g.value.__replace) || 0;
        continue;
      }
      const n = typeof g.value === "number" ? g.value : 0;
      // -1 is the project-wide "unlimited" sentinel. Any grant for this
      // limit being unlimited makes the resulting limit unlimited — adding
      // capacity to an already-unlimited cap is a no-op, so the engine
      // collapses to -1 and stops summing.
      if (limits[g.key] === -1 || n === -1) {
        limits[g.key] = -1;
      } else {
        limits[g.key] = (limits[g.key] ?? 0) + n;
      }
    } else if (kind === "integration") {
      if (isReplace<string[]>(g.value)) {
        integrationReplacements[g.key] = Array.isArray(g.value.__replace)
          ? [...g.value.__replace]
          : [];
        continue;
      }
      if (!Array.isArray(g.value)) continue;
      const bag = integrations[g.key] ?? new Set<string>();
      for (const item of g.value) {
        if (typeof item === "string") bag.add(item);
      }
      integrations[g.key] = bag;
    }
  }

  for (const [k, v] of Object.entries(featureReplacements)) features[k] = v;
  for (const [k, v] of Object.entries(limitReplacements)) limits[k] = v;
  for (const [k, v] of Object.entries(integrationReplacements))
    integrations[k] = new Set(v);

  const integrationsOut: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(integrations))
    integrationsOut[k] = [...set].sort();

  return {
    features,
    limits,
    integrations: integrationsOut,
    computedAt: now.toISOString(),
  };
}

/** Helper: did any of these grants enable feature X? */
export function hasFeature(set: EntitlementSet, key: string): boolean {
  return Boolean(set.features[key]);
}

/** Helper: numeric limit, with caller-supplied default for "unlimited". */
export function limitOf(
  set: EntitlementSet,
  key: string,
  fallback = 0,
): number {
  return set.limits[key] ?? fallback;
}

/** Helper: is the resulting limit unlimited (sentinel -1)? */
export function isUnlimitedLimit(set: EntitlementSet, key: string): boolean {
  return set.limits[key] === -1;
}

/** Helper: is this integration provider permitted under the current entitlements? */
export function allowsIntegration(
  set: EntitlementSet,
  key: string,
  providerId: string,
): boolean {
  const list = set.integrations[key];
  if (!list) return false;
  return list.includes("*") || list.includes(providerId);
}
