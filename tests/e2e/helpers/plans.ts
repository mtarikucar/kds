import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from './api';
import {
  upgradeViaPayTR,
  forceDowngrade,
  markEmailVerified,
} from './paytr-plan-switch';

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

const PLAN_PRICE_ORDER: Record<PlanName, number> = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
  BUSINESS: 3,
};

async function planNameFromId(superApi: APIRequestContext, planId: string): Promise<PlanName> {
  const plans = await listPlans(superApi);
  const row = plans.find((p) => p.id === planId);
  if (!row) throw new Error(`Plan id ${planId} not found in superadmin/plans`);
  return row.name;
}

/**
 * Switch the demo tenant's current plan to `newPlan`.
 *
 * Upgrades (price up) go through the production PayTR flow:
 *   POST /payments/create-intent  →  PendingPlanChange + SubscriptionPayment
 *   POST /webhooks/paytr (simulated success) →  webhook activates new plan
 *
 * Downgrades (price down) use the superadmin PATCH path. Production
 * schedules downgrades for period end and applies them via a scheduler
 * tick; tests collapse to immediate. The Subscription.planId /
 * Tenant.currentPlanId end state is identical either way, which is
 * all the PlanFeatureGuard observes.
 *
 * Returns a restore() that puts the original plan back. Restore is
 * direction-aware (upgrade vs downgrade) and idempotent.
 */
export async function switchTenantPlan(
  superApi: APIRequestContext,
  tenantId: string,
  newPlan: PlanName,
): Promise<{ restore: () => Promise<void>; subscriptionId: string; previousPlanId: string }> {
  const sub = await findActiveSubscriptionForTenant(superApi, tenantId);
  if (!sub) {
    throw new Error(
      `No live subscription for tenant ${tenantId}; switchTenantPlan needs an ACTIVE/TRIALING/PAST_DUE row`,
    );
  }
  const previousPlanId = sub.planId;
  const newPlanId = await getPlanIdByName(superApi, newPlan);
  if (previousPlanId === newPlanId) {
    return { restore: async () => {}, subscriptionId: sub.id, previousPlanId };
  }

  const previousPlanName = await planNameFromId(superApi, previousPlanId);
  await applyPlanChange(superApi, tenantId, sub.id, previousPlanName, newPlan);

  let restored = false;
  const restore = async (): Promise<void> => {
    if (restored) return;
    restored = true;
    // Re-read current state because intervening tests / restores may have
    // already moved the tenant. If we're already on previousPlanName,
    // there's nothing to do.
    const live = await findActiveSubscriptionForTenant(superApi, tenantId);
    if (!live) return;
    const liveName = await planNameFromId(superApi, live.planId);
    if (liveName === previousPlanName) return;
    await applyPlanChange(superApi, tenantId, live.id, liveName, previousPlanName);
  };
  return { restore, subscriptionId: sub.id, previousPlanId };
}

async function applyPlanChange(
  superApi: APIRequestContext,
  tenantId: string,
  subscriptionId: string,
  fromPlan: PlanName,
  toPlan: PlanName,
): Promise<void> {
  const isUpgrade = PLAN_PRICE_ORDER[toPlan] > PLAN_PRICE_ORDER[fromPlan];
  if (isUpgrade) {
    // Resolve the tenant's admin user so create-intent can be called
    // and emailVerified can be flipped via superadmin.
    const { api: adminApi, user: adminUser } = await loginAsApi('admin');
    try {
      await markEmailVerified(superApi, adminUser.id);
      await upgradeViaPayTR(adminApi, superApi, adminUser.id, toPlan);
    } finally {
      await adminApi.dispose();
    }
    return;
  }
  // Downgrade: superadmin PATCH. The end state matches
  // applyScheduledDowngrade's output (Subscription.planId and
  // Tenant.currentPlanId both updated atomically).
  const newPlanId = await getPlanIdByName(superApi, toPlan);
  await forceDowngrade(superApi, subscriptionId, newPlanId);
  // Voids unused tenantId in this branch but kept for symmetry / future
  // extension (e.g., audit-log assertion on currentPlanId).
  void tenantId;
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
