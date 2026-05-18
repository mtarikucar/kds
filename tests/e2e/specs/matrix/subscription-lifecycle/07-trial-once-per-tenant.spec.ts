import { test, expect } from '../../../fixtures/test';
import { loginAsSuperAdmin } from '../../../helpers/api';
import { registerFreshTenant } from '../../../helpers/fresh-tenant';
import { markEmailVerified, forceDowngrade } from '../../../helpers/paytr-plan-switch';
import { getPlanIdByName } from '../../../helpers/plans';

/**
 * Trial is once per tenant for life. Previously the gate read
 * `tenant.usedTrialPlanIds.includes(planId)` (per-plan), so a tenant
 * who trialed BASIC could later trial PRO and BUSINESS for free —
 * effectively 42 days of free service across three trials. The gate
 * now reads `tenant.trialUsed`; once any trial fires, subsequent
 * /payments/create-intent calls return provider='PAYTR' (charge), not
 * 'TRIAL' (free).
 *
 * Setup for each test:
 *   - Fresh tenant registration auto-starts a BUSINESS trial
 *     (trialUsed=true is stamped on the tenant by AuthService.register).
 *   - Force-downgrade the subscription to FREE so create-intent's
 *     `isOnFreeOrNone` precondition matches (the gate ONLY fires when
 *     the tenant is on FREE/none — paid → paid takes the upgrade path
 *     and never touches trial logic).
 *   - Now ask for a trial on a DIFFERENT plan and watch the response.
 */
test.describe('Subscription lifecycle — trial is once per tenant', () => {
  test('after BUSINESS trial used, PRO checkout charges instead of trialing', async () => {
    const fresh = await registerFreshTenant('once-pro');
    const { api: superApi } = await loginAsSuperAdmin();
    try {
      await markEmailVerified(superApi, fresh.user.id);

      // 1. Confirm starting state: TRIALING BUSINESS, trialUsed=true.
      const sub = await (await fresh.api.get('subscriptions/current')).json();
      expect(sub.plan.name).toBe('BUSINESS');
      expect(sub.status).toBe('TRIALING');

      // 2. Drop to FREE so create-intent's `isOnFreeOrNone` gate matches
      //    (paid→paid path never even consults trial eligibility).
      const freePlanId = await getPlanIdByName(superApi, 'FREE');
      await forceDowngrade(superApi, sub.id, freePlanId);

      // 3. Ask for PRO. The previous gate would have offered a TRIAL
      //    here because PRO wasn't in usedTrialPlanIds. The new gate
      //    rejects trial because trialUsed=true, so we get a real
      //    PayTR intent — confirming the charge path.
      const proPlanId = await getPlanIdByName(superApi, 'PRO');
      const res = await fresh.api.post('payments/create-intent', {
        data: { planId: proPlanId, billingCycle: 'MONTHLY' },
      });
      expect(res.ok()).toBeTruthy();
      const intent = await res.json();
      expect(intent.provider).toBe('PAYTR');
      expect(intent.trialActivated).toBeFalsy();
      expect(intent.merchantOid).toBeTruthy();
      // amount > 0 — the user is being charged, not trialing.
      expect(intent.amount).toBeGreaterThan(0);
    } finally {
      await fresh.api.dispose();
    }
  });

  test('after BUSINESS trial used, BUSINESS re-checkout also charges', async () => {
    // Re-checking the same plan you trialed should also charge — the
    // gate is per-tenant, not per-plan, so even returning to the trialed
    // plan goes through PayTR.
    const fresh = await registerFreshTenant('once-business');
    const { api: superApi } = await loginAsSuperAdmin();
    try {
      await markEmailVerified(superApi, fresh.user.id);
      const sub = await (await fresh.api.get('subscriptions/current')).json();
      const freePlanId = await getPlanIdByName(superApi, 'FREE');
      await forceDowngrade(superApi, sub.id, freePlanId);

      const businessPlanId = await getPlanIdByName(superApi, 'BUSINESS');
      const res = await fresh.api.post('payments/create-intent', {
        data: { planId: businessPlanId, billingCycle: 'MONTHLY' },
      });
      expect(res.ok()).toBeTruthy();
      const intent = await res.json();
      expect(intent.provider).toBe('PAYTR');
      expect(intent.trialActivated).toBeFalsy();
    } finally {
      await fresh.api.dispose();
    }
  });

  test('legacy tenant with trialUsed=false is still trial-eligible exactly once', async () => {
    // A tenant created before the auto-trial change (or one whose
    // trialUsed flag was reset manually) should still be able to start
    // exactly ONE trial — but only one. This guards against the gate
    // being overly aggressive.
    const fresh = await registerFreshTenant('once-legacy');
    const { api: superApi } = await loginAsSuperAdmin();
    try {
      await markEmailVerified(superApi, fresh.user.id);
      const sub = await (await fresh.api.get('subscriptions/current')).json();
      const freePlanId = await getPlanIdByName(superApi, 'FREE');

      // Drop to FREE and reset trial bookkeeping to simulate a legacy
      // tenant. We use the superadmin tenant-overrides PATCH to clear
      // trialUsed; if that endpoint can't toggle the field directly,
      // skip the legacy half (this branch tightens the trial-once
      // contract, the main per-tenant gate is exercised by the two
      // tests above).
      await forceDowngrade(superApi, sub.id, freePlanId);

      const resetRes = await superApi.patch(`superadmin/tenants/${fresh.user.tenantId}`, {
        data: { trialUsed: false, usedTrialPlanIds: [] },
      });
      test.skip(
        !resetRes.ok(),
        `superadmin tenant PATCH does not accept trialUsed reset (${resetRes.status()}); legacy half of this matrix is unreachable from outside the DB`,
      );

      // First trial attempt — should succeed via TRIAL provider.
      const proPlanId = await getPlanIdByName(superApi, 'PRO');
      const firstRes = await fresh.api.post('payments/create-intent', {
        data: { planId: proPlanId, billingCycle: 'MONTHLY' },
      });
      expect(firstRes.ok()).toBeTruthy();
      const first = await firstRes.json();
      expect(first.provider).toBe('TRIAL');

      // Second attempt on a different plan — should now charge.
      const basicPlanId = await getPlanIdByName(superApi, 'BASIC');
      const secondRes = await fresh.api.post('payments/create-intent', {
        data: { planId: basicPlanId, billingCycle: 'MONTHLY' },
      });
      expect(secondRes.ok()).toBeTruthy();
      const second = await secondRes.json();
      expect(second.provider).toBe('PAYTR');
    } finally {
      await fresh.api.dispose();
    }
  });
});
