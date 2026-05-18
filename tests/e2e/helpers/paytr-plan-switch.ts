import { APIRequestContext } from '@playwright/test';
import { simulatePaytrSuccess, simulatePaytrFailure } from './paytr-webhook';
import { loginAsApi, loginAsSuperAdmin } from './api';
import { getPlanIdByName, PlanName } from './plans';

/**
 * PayTR-driven plan switch helper.
 *
 * Upgrades go through the production flow:
 *   1. mark admin user emailVerified (createIntent gate)
 *   2. POST /payments/create-intent → mints a PayTR token (synthetic in
 *      E2E thanks to PAYTR_USE_FAKE_ADAPTER=true in playwright.config.ts)
 *      and persists a PendingPlanChange row keyed off merchant_oid
 *   3. simulatePaytrSuccess(merchantOid, amountKurus) → webhook activates
 *      the new plan, updates Subscription.planId AND Tenant.currentPlanId,
 *      writes a SubscriptionPayment + Invoice, clears the PendingPlanChange
 *
 * Downgrades stay on the superadmin PATCH path. In production a downgrade
 * is *scheduled* for period end (no PayTR call); for tests we collapse
 * that to an immediate state change so feature-gate assertions can run
 * without a scheduler tick. The end state is identical to what the
 * scheduler would produce.
 *
 * FREE → paid is the production trial path (createIntent short-circuits
 * to startTrialFromIntent and never calls PayTR). We follow the same
 * path and skip the webhook leg — the tenant lands on TRIALING which
 * PlanFeatureGuard treats as live.
 */

interface PlanRow {
  id: string;
  name: PlanName;
  monthlyPrice: number | string;
  yearlyPrice: number | string;
  currency: string;
}

interface CurrentSubscriptionResponse {
  id: string;
  status: string;
  planId: string;
  plan: { id: string; name: PlanName; monthlyPrice: number | string; yearlyPrice: number | string };
  billingCycle: 'MONTHLY' | 'YEARLY';
}

interface CreateIntentResponse {
  provider: 'PAYTR' | 'TRIAL';
  merchantOid?: string;
  amount: number;
  currency: string;
  trialActivated?: boolean;
}

const PLAN_PRICE_ORDER: Record<PlanName, number> = {
  FREE: 0,
  BASIC: 1,
  PRO: 2,
  BUSINESS: 3,
};

async function fetchPlans(api: APIRequestContext): Promise<PlanRow[]> {
  const res = await api.get('subscriptions/plans');
  if (!res.ok()) throw new Error(`fetch plans: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return Array.isArray(body) ? body : body.data ?? body.items ?? [];
}

async function fetchCurrentSubscription(
  api: APIRequestContext,
): Promise<CurrentSubscriptionResponse> {
  const res = await api.get('subscriptions/current');
  if (!res.ok()) throw new Error(`current subscription: ${res.status()} ${await res.text()}`);
  return res.json();
}

/**
 * Mark the calling user emailVerified=true. The /payments/create-intent
 * gate rejects unverified users, and the demo seed leaves verification
 * off. Idempotent — calling on an already-verified user is a noop on
 * the backend.
 */
export async function markEmailVerified(
  superApi: APIRequestContext,
  userId: string,
): Promise<void> {
  const res = await superApi.patch(`superadmin/users/${userId}/email-verification`, {
    data: { emailVerified: true },
  });
  if (!res.ok()) {
    throw new Error(`mark emailVerified: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Drive a real PayTR-style upgrade end-to-end. Returns the merchantOid
 * of the activating payment so callers can correlate audit / invoice
 * rows. Throws if the target plan is not strictly higher-priced than
 * the current one (use {@link forceDowngrade} for that direction).
 */
export async function upgradeViaPayTR(
  adminApi: APIRequestContext,
  superApi: APIRequestContext,
  adminUserId: string,
  targetPlan: PlanName,
  billingCycle: 'MONTHLY' | 'YEARLY' = 'MONTHLY',
): Promise<{ merchantOid: string; provider: 'PAYTR' | 'TRIAL' }> {
  await markEmailVerified(superApi, adminUserId);

  const current = await fetchCurrentSubscription(adminApi);
  const plans = await fetchPlans(adminApi);
  const target = plans.find((p) => p.name === targetPlan);
  if (!target) throw new Error(`upgradeViaPayTR: target plan ${targetPlan} not found`);

  if (PLAN_PRICE_ORDER[targetPlan] <= PLAN_PRICE_ORDER[current.plan.name]) {
    throw new Error(
      `upgradeViaPayTR: ${targetPlan} is not an upgrade from ${current.plan.name}; use forceDowngrade instead`,
    );
  }

  const res = await adminApi.post('payments/create-intent', {
    data: { planId: target.id, billingCycle },
  });
  if (!res.ok()) {
    throw new Error(`create-intent ${targetPlan}: ${res.status()} ${await res.text()}`);
  }
  const intent: CreateIntentResponse = await res.json();

  // FREE → paid is the trial short-circuit. No PayTR webhook needed —
  // SubscriptionService.startTrialFromIntent already promoted the
  // subscription to TRIALING on the target plan inside createIntent.
  if (intent.provider === 'TRIAL') {
    return { merchantOid: '', provider: 'TRIAL' };
  }

  if (!intent.merchantOid) {
    throw new Error(`create-intent returned PAYTR provider but no merchantOid: ${JSON.stringify(intent)}`);
  }

  // PayTR amounts are in kuruş. createIntent returns whole units (e.g. 1299 TRY);
  // the webhook hash is computed over the kuruş string (e.g. "129900").
  const amountKurus = Math.round(intent.amount * 100).toString();
  await simulatePaytrSuccess({ merchantOid: intent.merchantOid, totalAmountKurus: amountKurus });

  return { merchantOid: intent.merchantOid, provider: 'PAYTR' };
}

/**
 * Force a downgrade by directly writing Subscription.planId and
 * Tenant.currentPlanId via the superadmin endpoint. Production would
 * schedule this for period end and apply via a scheduler tick; tests
 * collapse to immediate so feature-gate assertions don't have to wait.
 * The end state is identical to what {@link SubscriptionService.applyScheduledDowngrade}
 * produces at the period boundary.
 *
 * Will surface the backend's "downgrade exceeds new plan limits" error
 * verbatim so callers can assert on it.
 */
export async function forceDowngrade(
  superApi: APIRequestContext,
  subscriptionId: string,
  newPlanId: string,
): Promise<void> {
  const res = await superApi.patch(`superadmin/subscriptions/${subscriptionId}`, {
    data: { planId: newPlanId },
  });
  if (!res.ok()) {
    throw new Error(`force downgrade: ${res.status()} ${await res.text()}`);
  }
}

/**
 * One-shot helper that drops the current plan back to a baseline target
 * regardless of direction. Used by `restore` callbacks in matrix tests
 * — the test doesn't care HOW the previous plan is restored, only that
 * subsequent specs start in a clean state. Upgrades replay the PayTR
 * chain; downgrades take the superadmin PATCH path.
 */
export async function restoreToPlan(
  adminApi: APIRequestContext,
  superApi: APIRequestContext,
  adminUserId: string,
  subscriptionId: string,
  targetPlan: PlanName,
): Promise<void> {
  const current = await fetchCurrentSubscription(adminApi);
  if (current.plan.name === targetPlan) return;

  if (PLAN_PRICE_ORDER[targetPlan] > PLAN_PRICE_ORDER[current.plan.name]) {
    await upgradeViaPayTR(adminApi, superApi, adminUserId, targetPlan, current.billingCycle);
    return;
  }
  const plans = await fetchPlans(adminApi);
  const target = plans.find((p) => p.name === targetPlan);
  if (!target) throw new Error(`restoreToPlan: ${targetPlan} not in catalog`);
  await forceDowngrade(superApi, subscriptionId, target.id);
}

/**
 * Simulate a PayTR-failed upgrade. Mints the same intent + token, then
 * delivers a `status=failed` webhook. After this returns, the
 * SubscriptionPayment row is FAILED and the PendingPlanChange is left
 * in place (TTL sweeper picks it up). Useful for the failed-payment
 * subscription-lifecycle spec.
 */
export async function attemptUpgradeWithFailure(
  adminApi: APIRequestContext,
  superApi: APIRequestContext,
  adminUserId: string,
  targetPlan: PlanName,
  billingCycle: 'MONTHLY' | 'YEARLY' = 'MONTHLY',
): Promise<{ merchantOid: string }> {
  await markEmailVerified(superApi, adminUserId);

  const current = await fetchCurrentSubscription(adminApi);
  const plans = await fetchPlans(adminApi);
  const target = plans.find((p) => p.name === targetPlan);
  if (!target) throw new Error(`attemptUpgradeWithFailure: ${targetPlan} not found`);
  if (PLAN_PRICE_ORDER[targetPlan] <= PLAN_PRICE_ORDER[current.plan.name]) {
    throw new Error(`attemptUpgradeWithFailure: ${targetPlan} is not an upgrade from ${current.plan.name}`);
  }

  const res = await adminApi.post('payments/create-intent', {
    data: { planId: target.id, billingCycle },
  });
  if (!res.ok()) {
    throw new Error(`create-intent: ${res.status()} ${await res.text()}`);
  }
  const intent: CreateIntentResponse = await res.json();
  if (intent.provider !== 'PAYTR' || !intent.merchantOid) {
    throw new Error(`failure-path requires PAYTR provider, got ${JSON.stringify(intent)}`);
  }
  const amountKurus = Math.round(intent.amount * 100).toString();
  await simulatePaytrFailure({
    merchantOid: intent.merchantOid,
    totalAmountKurus: amountKurus,
    reason: 'card declined (test)',
  });
  return { merchantOid: intent.merchantOid };
}
