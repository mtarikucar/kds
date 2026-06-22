import {
  SUBSCRIPTION_PLANS,
  PlanConfig,
} from "../../../common/constants/subscription-plans.const";
import { SubscriptionPlanType } from "../../../common/constants/subscription.enum";
import { foldPlanGrants, PlanGrantSource } from "./effective-features.fold";

/**
 * THE feature × plan matrix — the single, exhaustive assertion that EVERY
 * feature behaves correctly in EVERY plan, end-to-end through the production
 * effective-features fold (`foldPlanGrants`) that both the PlanFeatureGuard
 * (backend 403s) and the frontend `hasFeature()` UI gates read.
 *
 * The CANONICAL matrix below is transcribed from the source of truth
 * `backend/prisma/seed.ts` (FREE/BASIC/PRO/BUSINESS create payloads). Any
 * drift between this matrix, the SUBSCRIPTION_PLANS const, and the fold
 * output fails the suite — closing the historical 3-way drift (schema /
 * projector / fallback) that hid POS on fresh BUSINESS tenants.
 */

// 11 features + 6 limits, every plan, transcribed from seed.ts.
type FeatureFlags = Omit<
  PlanGrantSource,
  | "maxUsers"
  | "maxTables"
  | "maxBranches"
  | "maxProducts"
  | "maxCategories"
  | "maxMonthlyOrders"
>;
type LimitFlags = Pick<
  PlanGrantSource,
  | "maxUsers"
  | "maxTables"
  | "maxBranches"
  | "maxProducts"
  | "maxCategories"
  | "maxMonthlyOrders"
>;

const F = false;
const T = true;

const FEATURE_MATRIX: Record<SubscriptionPlanType, FeatureFlags> = {
  [SubscriptionPlanType.FREE]: {
    advancedReports: F, multiLocation: F, customBranding: F, apiAccess: F,
    externalDisplay: F,
    prioritySupport: F, inventoryTracking: F, kdsIntegration: T,
    reservationSystem: F, personnelManagement: F, deliveryIntegration: F,
    posAccess: F,
  },
  [SubscriptionPlanType.BASIC]: {
    advancedReports: F, multiLocation: F, customBranding: F, apiAccess: F,
    externalDisplay: F,
    prioritySupport: F, inventoryTracking: T, kdsIntegration: T,
    reservationSystem: F, personnelManagement: F, deliveryIntegration: F,
    posAccess: T,
  },
  [SubscriptionPlanType.PRO]: {
    advancedReports: T, multiLocation: T, customBranding: T, apiAccess: F,
    externalDisplay: F,
    prioritySupport: T, inventoryTracking: T, kdsIntegration: T,
    reservationSystem: T, personnelManagement: T, deliveryIntegration: T,
    posAccess: T,
  },
  [SubscriptionPlanType.BUSINESS]: {
    advancedReports: T, multiLocation: T, customBranding: T, apiAccess: T,
    externalDisplay: T,
    prioritySupport: T, inventoryTracking: T, kdsIntegration: T,
    reservationSystem: T, personnelManagement: T, deliveryIntegration: T,
    posAccess: T,
  },
};

const LIMIT_MATRIX: Record<SubscriptionPlanType, LimitFlags> = {
  [SubscriptionPlanType.FREE]: { maxUsers: 2, maxTables: 5, maxBranches: 1, maxProducts: 25, maxCategories: 5, maxMonthlyOrders: 50 },
  [SubscriptionPlanType.BASIC]: { maxUsers: 5, maxTables: 20, maxBranches: 1, maxProducts: 100, maxCategories: 20, maxMonthlyOrders: 500 },
  [SubscriptionPlanType.PRO]: { maxUsers: 15, maxTables: 50, maxBranches: 3, maxProducts: 500, maxCategories: 50, maxMonthlyOrders: 2000 },
  [SubscriptionPlanType.BUSINESS]: { maxUsers: -1, maxTables: -1, maxBranches: -1, maxProducts: -1, maxCategories: -1, maxMonthlyOrders: -1 },
};

const PLAN_TIERS = [
  SubscriptionPlanType.FREE,
  SubscriptionPlanType.BASIC,
  SubscriptionPlanType.PRO,
  SubscriptionPlanType.BUSINESS,
];
const FEATURE_KEYS = Object.keys(
  FEATURE_MATRIX[SubscriptionPlanType.FREE],
) as (keyof FeatureFlags)[];
const LIMIT_KEYS = Object.keys(
  LIMIT_MATRIX[SubscriptionPlanType.FREE],
) as (keyof LimitFlags)[];

function planSource(tier: SubscriptionPlanType): PlanGrantSource {
  return { ...FEATURE_MATRIX[tier], ...LIMIT_MATRIX[tier] };
}

describe("Feature × Plan matrix (every feature, every plan)", () => {
  // ── 1. The SUBSCRIPTION_PLANS const matches the seed.ts source of truth ──
  describe("SUBSCRIPTION_PLANS const agrees with the canonical matrix", () => {
    for (const tier of PLAN_TIERS) {
      const cfg: PlanConfig = SUBSCRIPTION_PLANS[tier];
      for (const f of FEATURE_KEYS) {
        it(`${tier}.${f} const = ${FEATURE_MATRIX[tier][f]}`, () => {
          expect(cfg.features[f]).toBe(FEATURE_MATRIX[tier][f]);
        });
      }
      for (const l of LIMIT_KEYS) {
        it(`${tier}.${l} const = ${LIMIT_MATRIX[tier][l]}`, () => {
          expect(cfg.limits[l]).toBe(LIMIT_MATRIX[tier][l]);
        });
      }
    }
  });

  // ── 2. The production fold reproduces the matrix exactly (no add-ons) ────
  // foldPlanGrants is what PlanFeatureGuard + the frontend hasFeature() read,
  // so this asserts the ACTUAL gate decision for every (plan, feature).
  describe("foldPlanGrants(plan) reproduces the matrix for every plan", () => {
    for (const tier of PLAN_TIERS) {
      const folded = foldPlanGrants(planSource(tier), [], null, null);
      for (const f of FEATURE_KEYS) {
        const expected = FEATURE_MATRIX[tier][f];
        it(`${tier}: feature ${f} ${expected ? "USABLE" : "GATED"}`, () => {
          expect(folded.features[f]).toBe(expected);
        });
      }
      for (const l of LIMIT_KEYS) {
        it(`${tier}: limit ${l} = ${LIMIT_MATRIX[tier][l]}`, () => {
          expect(folded.limits[l]).toBe(LIMIT_MATRIX[tier][l]);
        });
      }
    }
  });

  // ── 3. No feature is silently absent from the fold for any plan ──────────
  it("the fold emits exactly the 11 known feature keys for every plan", () => {
    for (const tier of PLAN_TIERS) {
      const folded = foldPlanGrants(planSource(tier), [], null, null);
      expect(Object.keys(folded.features).sort()).toEqual(
        [...FEATURE_KEYS].sort(),
      );
      expect(Object.keys(folded.limits).sort()).toEqual([...LIMIT_KEYS].sort());
    }
  });

  // ── 4. Add-on upgrade path: a feature a plan LACKS can be granted ────────
  describe("a marketplace add-on grants a lacked feature in every plan", () => {
    for (const tier of PLAN_TIERS) {
      const lacked = FEATURE_KEYS.filter((f) => !FEATURE_MATRIX[tier][f]);
      for (const f of lacked) {
        it(`${tier}: add-on turns ${f} ON`, () => {
          const folded = foldPlanGrants(
            planSource(tier),
            [{ grants: { [`feature.${f}`]: true }, quantity: 1 }],
            null,
            null,
          );
          expect(folded.features[f]).toBe(true);
        });
      }
    }
  });

  // ── 5. Superadmin override path: any feature can be forced OFF per plan ──
  describe("a tenant feature override REPLACEs the plan value in every plan", () => {
    for (const tier of PLAN_TIERS) {
      const has = FEATURE_KEYS.filter((f) => FEATURE_MATRIX[tier][f]);
      for (const f of has) {
        it(`${tier}: override forces ${f} OFF`, () => {
          const folded = foldPlanGrants(
            planSource(tier),
            [],
            { [f]: false },
            null,
          );
          expect(folded.features[f]).toBe(false);
        });
      }
    }
  });

  // ── 6. Monotonicity: every higher tier is a feature SUPERSET of lower ────
  // FREE ⊆ BASIC ⊆ PRO ⊆ BUSINESS. A logical regression (a feature dropped
  // at a higher tier) would break this — exactly the "no logical errors" bar.
  it("feature grants are monotonic up the tiers (FREE ⊆ BASIC ⊆ PRO ⊆ BUSINESS)", () => {
    for (let i = 1; i < PLAN_TIERS.length; i++) {
      const lower = FEATURE_MATRIX[PLAN_TIERS[i - 1]];
      const higher = FEATURE_MATRIX[PLAN_TIERS[i]];
      for (const f of FEATURE_KEYS) {
        if (lower[f]) {
          expect(higher[f]).toBe(true);
        }
      }
    }
  });
});
