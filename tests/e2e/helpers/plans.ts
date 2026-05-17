import { APIRequestContext } from '@playwright/test';
import { loginAsSuperAdmin } from './api';

export type PlanName = 'FREE' | 'BASIC' | 'PRO' | 'BUSINESS';

export const PLAN_FEATURES: Record<PlanName, Record<string, boolean>> = {
  FREE: {
    advancedReports: false,
    multiLocation: false,
    customBranding: false,
    apiAccess: false,
    prioritySupport: false,
    inventoryTracking: false,
    kdsIntegration: true,
    reservationSystem: false,
    personnelManagement: false,
    deliveryIntegration: false,
  },
  BASIC: {
    advancedReports: false,
    multiLocation: false,
    customBranding: false,
    apiAccess: false,
    prioritySupport: false,
    inventoryTracking: true,
    kdsIntegration: true,
    reservationSystem: false,
    personnelManagement: false,
    deliveryIntegration: false,
  },
  PRO: {
    advancedReports: true,
    multiLocation: true,
    customBranding: true,
    apiAccess: false,
    prioritySupport: true,
    inventoryTracking: true,
    kdsIntegration: true,
    reservationSystem: true,
    personnelManagement: true,
    deliveryIntegration: true,
  },
  BUSINESS: {
    advancedReports: true,
    multiLocation: true,
    customBranding: true,
    apiAccess: true,
    prioritySupport: true,
    inventoryTracking: true,
    kdsIntegration: true,
    reservationSystem: true,
    personnelManagement: true,
    deliveryIntegration: true,
  },
};

export const PLAN_LIMITS: Record<
  PlanName,
  { maxUsers: number; maxTables: number; maxProducts: number; maxCategories: number; maxMonthlyOrders: number }
> = {
  FREE: { maxUsers: 2, maxTables: 5, maxProducts: 25, maxCategories: 5, maxMonthlyOrders: 50 },
  BASIC: { maxUsers: 5, maxTables: 20, maxProducts: 100, maxCategories: 20, maxMonthlyOrders: 500 },
  PRO: { maxUsers: 15, maxTables: 50, maxProducts: 500, maxCategories: 50, maxMonthlyOrders: 2000 },
  BUSINESS: { maxUsers: -1, maxTables: -1, maxProducts: -1, maxCategories: -1, maxMonthlyOrders: -1 },
};

interface PlanRow {
  id: string;
  name: PlanName;
  displayName: string;
}

interface SubscriptionRow {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
}

let plansCache: PlanRow[] | null = null;

async function listPlans(superApi: APIRequestContext): Promise<PlanRow[]> {
  if (plansCache) return plansCache;
  const res = await superApi.get('superadmin/plans');
  if (!res.ok()) throw new Error(`list plans: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  const items: PlanRow[] = Array.isArray(body) ? body : body.data ?? body.items ?? [];
  plansCache = items;
  return items;
}

export async function getPlanIdByName(superApi: APIRequestContext, name: PlanName): Promise<string> {
  const plans = await listPlans(superApi);
  const hit = plans.find((p) => p.name === name);
  if (!hit) throw new Error(`Plan ${name} not found in superadmin/plans`);
  return hit.id;
}

async function findActiveSubscriptionForTenant(
  superApi: APIRequestContext,
  tenantId: string,
): Promise<SubscriptionRow | null> {
  // The superadmin subscriptions list endpoint accepts filters.
  // We ask for tenant + status=ACTIVE; if absent, fall back to TRIALING
  // / PAST_DUE which the PlanFeatureGuard also treats as "live".
  const tryStatus = async (status: string): Promise<SubscriptionRow | null> => {
    const res = await superApi.get(`superadmin/subscriptions?tenantId=${tenantId}&status=${status}`);
    if (!res.ok()) return null;
    const body = await res.json();
    const items: SubscriptionRow[] = Array.isArray(body) ? body : body.data ?? body.items ?? [];
    return items[0] ?? null;
  };
  return (
    (await tryStatus('ACTIVE')) ??
    (await tryStatus('TRIALING')) ??
    (await tryStatus('PAST_DUE'))
  );
}

/**
 * Switch the demo tenant's current plan via the superadmin
 * `PATCH /superadmin/subscriptions/:id` endpoint. That handler
 * atomically moves both Subscription.planId AND Tenant.currentPlanId,
 * so the PlanFeatureGuard sees the new flags immediately on the next
 * request.
 *
 * The guard also requires a live subscription for non-FREE plans, so
 * we never touch Subscription.status — the existing ACTIVE/TRIALING
 * row keeps the tenant "live" while only its plan reference moves.
 *
 * Returns a restore() that puts the original plan back. Restore is
 * idempotent; calling it twice is a noop.
 */
export async function switchTenantPlan(
  superApi: APIRequestContext,
  tenantId: string,
  newPlan: PlanName,
): Promise<{ restore: () => Promise<void>; subscriptionId: string; previousPlanId: string }> {
  const sub = await findActiveSubscriptionForTenant(superApi, tenantId);
  if (!sub) {
    throw new Error(
      `No live subscription for tenant ${tenantId}; cannot switch plan via PATCH /superadmin/subscriptions/:id`,
    );
  }
  const previousPlanId = sub.planId;
  const newPlanId = await getPlanIdByName(superApi, newPlan);

  if (previousPlanId === newPlanId) {
    return { restore: async () => {}, subscriptionId: sub.id, previousPlanId };
  }

  const res = await superApi.patch(`superadmin/subscriptions/${sub.id}`, {
    data: { planId: newPlanId },
  });
  if (!res.ok()) {
    throw new Error(`switchTenantPlan → ${newPlan}: ${res.status()} ${await res.text()}`);
  }

  let restored = false;
  const restore = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    const back = await superApi.patch(`superadmin/subscriptions/${sub.id}`, {
      data: { planId: previousPlanId },
    });
    if (!back.ok()) {
      throw new Error(`restore previous plan: ${back.status()} ${await back.text()}`);
    }
  };
  return { restore, subscriptionId: sub.id, previousPlanId };
}

/** Clear any leftover tenant featureOverrides so plan-only gating
 *  is observable. Tests that flip overrides should reset them
 *  themselves; this is a belt-and-braces helper for the matrix specs
 *  whose preconditions assume no overlay. */
export async function clearFeatureOverrides(
  superApi: APIRequestContext,
  tenantId: string,
): Promise<void> {
  const res = await superApi.patch(`superadmin/tenants/${tenantId}/overrides`, {
    data: {
      featureOverrides: {
        advancedReports: null,
        multiLocation: null,
        customBranding: null,
        apiAccess: null,
        prioritySupport: null,
        inventoryTracking: null,
        kdsIntegration: null,
        reservationSystem: null,
        personnelManagement: null,
        deliveryIntegration: null,
      },
      limitOverrides: {
        maxUsers: null,
        maxTables: null,
        maxProducts: null,
        maxCategories: null,
        maxMonthlyOrders: null,
      },
    },
  });
  if (!res.ok()) throw new Error(`clear overrides: ${res.status()} ${await res.text()}`);
}

/** Routes exposed by @RequiresFeature decorators, mapped to the
 *  feature flag they require. Used by the plan-matrix spec to assert
 *  200 vs 403 per plan tier. */
export const FEATURE_PROBE_ROUTES: { feature: keyof (typeof PLAN_FEATURES)['FREE']; method: 'GET'; path: string }[] = [
  { feature: 'inventoryTracking', method: 'GET', path: 'stock-management/items' },
  { feature: 'personnelManagement', method: 'GET', path: 'personnel/attendance/today' },
  { feature: 'reservationSystem', method: 'GET', path: 'reservations' },
  { feature: 'deliveryIntegration', method: 'GET', path: 'delivery-platforms/configs' },
  { feature: 'apiAccess', method: 'GET', path: 'admin/settings/integrations' },
  { feature: 'advancedReports', method: 'GET', path: 'reports/sales' },
];
