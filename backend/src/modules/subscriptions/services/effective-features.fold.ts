/**
 * Engine-empty fallback fold for getEffectiveFeatures, extracted from the
 * 1400-line SubscriptionService so the ~80-line plan+addon+override fold is a
 * pure, independently-testable unit — and so the FEATURE/LIMIT column mirror
 * (which MUST match PlanProjectorService's FEATURE_COLUMNS/LIMIT_COLUMNS, a
 * documented past drift bug) lives in one named place.
 *
 * Semantics mirror the engine projector exactly: plan base → add-on features
 * OR-true, add-on limits SUM (with -1 = unlimited preserved), integrations
 * array-union → tenant overrides REPLACE last.
 */

/** The plan columns the fold reads. Keep in lockstep with the engine. */
export interface PlanGrantSource {
  advancedReports: boolean;
  multiLocation: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  inventoryTracking: boolean;
  kdsIntegration: boolean;
  reservationSystem: boolean;
  personnelManagement: boolean;
  deliveryIntegration: boolean;
  posAccess: boolean;
  externalDisplay: boolean;
  maxUsers: number;
  maxTables: number;
  maxBranches: number;
  maxProducts: number;
  maxCategories: number;
  maxMonthlyOrders: number;
}

export interface ActiveAddOnGrant {
  grants: Record<string, unknown> | null | undefined;
  quantity: number | null | undefined;
}

export interface EffectiveFeaturesFold {
  features: Record<string, boolean>;
  limits: Record<string, number>;
  integrations: Record<string, string[]>;
}

export function foldPlanGrants(
  plan: PlanGrantSource,
  activeAddOns: ActiveAddOnGrant[],
  featureOverrides: Record<string, boolean> | null,
  limitOverrides: Record<string, number> | null,
): EffectiveFeaturesFold {
  const features: Record<string, boolean> = {
    advancedReports: plan.advancedReports,
    multiLocation: plan.multiLocation,
    customBranding: plan.customBranding,
    apiAccess: plan.apiAccess,
    prioritySupport: plan.prioritySupport,
    inventoryTracking: plan.inventoryTracking,
    kdsIntegration: plan.kdsIntegration,
    reservationSystem: plan.reservationSystem,
    personnelManagement: plan.personnelManagement,
    deliveryIntegration: plan.deliveryIntegration,
    posAccess: plan.posAccess,
    externalDisplay: plan.externalDisplay,
  };
  const limits: Record<string, number> = {
    maxUsers: plan.maxUsers,
    maxTables: plan.maxTables,
    maxBranches: plan.maxBranches,
    maxProducts: plan.maxProducts,
    maxCategories: plan.maxCategories,
    maxMonthlyOrders: plan.maxMonthlyOrders,
  };
  const integrations: Record<string, string[]> = {};

  // Fold active add-ons: features OR-true, limits SUM (× qty, -1 unlimited),
  // integrations array-union — same shape the engine's projector applies.
  for (const ta of activeAddOns) {
    const grants = (ta.grants ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(grants)) {
      if (k.startsWith("feature.")) {
        const name = k.slice("feature.".length);
        if (v === true && name in features) features[name] = true;
      } else if (k.startsWith("limit.")) {
        const name = k.slice("limit.".length);
        if (typeof v === "number" && name in limits) {
          if (limits[name] === -1 || v === -1) {
            limits[name] = -1;
          } else {
            limits[name] = limits[name] + v * (ta.quantity ?? 1);
          }
        }
      } else if (k.startsWith("integration.")) {
        const domain = k.slice("integration.".length);
        const vendors = Array.isArray(v) ? (v as string[]) : [];
        if (!integrations[domain]) integrations[domain] = [];
        for (const vendor of vendors) {
          if (!integrations[domain].includes(vendor)) {
            integrations[domain].push(vendor);
          }
        }
      }
    }
  }

  // Overrides win last (REPLACE semantics matching the engine).
  if (featureOverrides) {
    for (const [k, v] of Object.entries(featureOverrides)) {
      if (k in features) features[k] = v;
    }
  }
  if (limitOverrides) {
    for (const [k, v] of Object.entries(limitOverrides)) {
      if (k in limits) limits[k] = v;
    }
  }

  return { features, limits, integrations };
}
