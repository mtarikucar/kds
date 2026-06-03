// Domain types for the entitlement engine.
//
// Keys are dotted strings with a typed prefix:
//   feature.<name>      boolean    e.g. "feature.kds", "feature.advancedReports"
//   limit.<name>        number     e.g. "limit.maxTables", "limit.kdsScreens"
//   integration.<kind>  string[]   e.g. "integration.delivery" -> ["yemeksepeti","getir"]
//
// The prefix is what tells the fold function which combine rule to apply, so
// it MUST match the value shape. New shapes can be added by extending the
// fold without breaking existing callers.

export type EntitlementKeyKind = "feature" | "limit" | "integration";

export type EntitlementValue =
  | boolean
  | number
  | string[]
  | Record<string, unknown>;

/** One grant from one source. The DB row maps 1:1 onto this. */
export interface EntitlementGrant {
  tenantId: string;
  branchId: string | null;
  scope: "tenant" | "branch" | "device";
  key: string;
  value: EntitlementValue;
  /** Precise origin: "plan:PRO", "addon:kds-extra-screen:abc", "override:admin", "grace:past-due". */
  source: string;
  validUntil: Date | null;
}

/** The result of folding many grants for one tenant. Read-side shape. */
export interface EntitlementSet {
  features: Record<string, boolean>;
  limits: Record<string, number>;
  integrations: Record<string, string[]>;
  /** ISO-8601 of when this set was computed. UI uses it to display "as of". */
  computedAt: string;
}

export const EMPTY_ENTITLEMENT_SET: EntitlementSet = Object.freeze({
  features: {},
  limits: {},
  integrations: {},
  computedAt: new Date(0).toISOString(),
});

/** Inspect a key without parsing it twice. */
export function classify(key: string): EntitlementKeyKind | null {
  const dot = key.indexOf(".");
  if (dot <= 0) return null;
  const prefix = key.slice(0, dot);
  if (prefix === "feature" || prefix === "limit" || prefix === "integration") {
    return prefix;
  }
  return null;
}
