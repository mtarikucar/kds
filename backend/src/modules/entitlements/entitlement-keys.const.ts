/**
 * The canonical vocabulary of entitlement keys.
 *
 * Before v3.3.0 this vocabulary was implicit and mirrored by hand in at least
 * six places (`PlanFeature` enum, `LIMIT_COLUMNS`, `FEATURE_COLUMNS`, the
 * superadmin override DTOs, the frontend `PlanFeatures` type, and a snapshot
 * spec), each with its own drift-warning comment. The à-la-carte model makes
 * grants catalog-authored — a superadmin can type any key into a
 * `MarketplaceAddOn.grants` JSON blob — so an authoritative list stops being a
 * nicety and becomes the thing the catalog validator checks against. A typo
 * like `feature.advancedReport` would otherwise validate, publish, sell, and
 * grant nothing.
 *
 * This file is the single source. It has no imports and no framework
 * dependencies so the catalog validator, the projector, the offer resolver,
 * the seed and a generated frontend union can all read the same list.
 */

/**
 * Boolean capability flags. Names are unprefixed here and carry the
 * `feature.` prefix on the wire, matching the pre-3.3 `PlanFeature` enum
 * values exactly — that identity is what lets `@RequiresFeature` be
 * re-aliased onto `@RequireEntitlement` without touching 82 call sites.
 */
export const FEATURE_KEYS = [
  /**
   * Owning an active License. Granted by the license catalog row itself and
   * by nothing else. Every `requiresLicense` product's grants are suppressed
   * by the projector while this is absent, which is what makes a lapsed
   * license darken the whole paid surface without deleting anything.
   */
  "license",

  // --- free baseline (granted to every tenant, unconditionally) ---
  "posAccess",
  "kdsIntegration",
  "customBranding",
  /** The branch hub + picker UI. Free; branch CAPACITY is the paid part. */
  "multiLocation",

  // --- paid modules ---
  "advancedReports",
  "inventoryTracking",
  "reservationSystem",
  "personnelManagement",
  "aiContentGeneration",
  "apiAccess",
  "externalDisplay",
  "prioritySupport",
  /** Granted as a side effect of buying any delivery-platform integration. */
  "deliveryIntegration",
] as const;

/**
 * Numeric caps. À-la-carte keeps exactly ONE: every other limit became
 * unlimited and free. The others are listed so the free baseline can grant
 * them as `-1` (unlimited) and so any stale `plan:*` grant that outlives the
 * migration folds harmlessly — `-1` dominates the SUM.
 */
export const LIMIT_KEYS = [
  /** 1 free, +1 per purchased `extra_branch` unit. The only priced cap. */
  "maxBranches",
  // Retired caps, granted as -1 by the free baseline.
  "maxUsers",
  "maxTables",
  "maxProducts",
  "maxCategories",
  "maxMonthlyOrders",
] as const;

/** Integration domains. Values are vendor-id arrays, UNIONed across grants. */
export const INTEGRATION_KEYS = [
  "delivery",
  "fiscal",
  "caller",
  "sms",
  "accounting",
] as const;

/**
 * Prepaid consumption balances. Deliberately NOT entitlements — the engine's
 * `classify()` returns null for this prefix, so `credit.*` never reaches the
 * fold. Balances are read live inside the advisory-locked claim transaction
 * because a 30s-stale balance during a burst is a real money bug.
 *
 * Vocabulary matches `AiGenerationUsage.kind` so the P4 ledger migration is a
 * row-for-row copy rather than a value remap.
 */
export const CREDIT_KINDS = ["PHOTO", "VIDEO", "MODEL3D", "SMS"] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];
export type CreditKind = (typeof CREDIT_KINDS)[number];

const FEATURE_SET: ReadonlySet<string> = new Set(FEATURE_KEYS);
const LIMIT_SET: ReadonlySet<string> = new Set(LIMIT_KEYS);
const INTEGRATION_SET: ReadonlySet<string> = new Set(INTEGRATION_KEYS);
const CREDIT_SET: ReadonlySet<string> = new Set(CREDIT_KINDS);

export const featureKey = (name: FeatureKey): string => `feature.${name}`;
export const limitKey = (name: LimitKey): string => `limit.${name}`;
export const integrationKey = (name: IntegrationKey): string =>
  `integration.${name}`;

export function isCreditKind(value: unknown): value is CreditKind {
  return typeof value === "string" && CREDIT_SET.has(value);
}

/**
 * Is this a grant key the system actually reads?
 *
 * The catalog validator's whole job. Pre-3.3 the catalog shipped
 * `limit.kdsScreens`, `limit.kdsStations` and `limit.tablets` — three keys no
 * enforcement code has ever read — plus `limit.branches`, which was a typo
 * for `limit.maxBranches` that silently sold tenants a branch cap increase
 * they never received (fixed in 20260722130000_fix_extra_branch_grant).
 * Rejecting unknown keys at write time is what stops the next one.
 */
export function isKnownGrantKey(key: string): boolean {
  const dot = key.indexOf(".");
  if (dot <= 0) return false;
  const prefix = key.slice(0, dot);
  const name = key.slice(dot + 1);
  if (prefix === "feature") return FEATURE_SET.has(name);
  if (prefix === "limit") return LIMIT_SET.has(name);
  if (prefix === "integration") return INTEGRATION_SET.has(name);
  if (prefix === "credit") return CREDIT_SET.has(name);
  return false;
}

/** Every valid grant key, for admin pickers and error messages. */
export function allGrantKeys(): string[] {
  return [
    ...FEATURE_KEYS.map((k) => `feature.${k}`),
    ...LIMIT_KEYS.map((k) => `limit.${k}`),
    ...INTEGRATION_KEYS.map((k) => `integration.${k}`),
    ...CREDIT_KINDS.map((k) => `credit.${k}`),
  ];
}
