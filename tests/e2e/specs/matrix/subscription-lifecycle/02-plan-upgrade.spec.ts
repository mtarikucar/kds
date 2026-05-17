import { test, expect } from '../../../fixtures/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { upgradeViaPayTR, forceDowngrade } from '../../../helpers/paytr-plan-switch';
import { getPlanIdByName, PlanName } from '../../../helpers/plans';

/**
 * Phase 2 — Paid plan upgrade via the real PayTR-driven chain.
 *
 * We drive `upgradeViaPayTR`, which:
 *   1. flips emailVerified
 *   2. POSTs /payments/create-intent (which mints a synthetic PayTR token
 *      because PAYTR_USE_FAKE_ADAPTER=true)
 *   3. delivers a signed simulated webhook to /webhooks/paytr
 *
 * After return we assert:
 *   - the returned merchantOid is non-empty (PayTR rail, not TRIAL)
 *   - GET /subscriptions/current shows the new planId
 *   - the superadmin view exposes a SubscriptionPayment row with
 *     status=SUCCEEDED for that merchantOid
 *
 * Demo tenant constraint: the demo's usage profile is pinned on BUSINESS
 * (top tier). If the live plan is already the upgrade target, the test
 * skips with a clear message — the upgrade direction is impossible from
 * the current state.
 */
test.describe('Subscription lifecycle — paid plan upgrade', () => {
  test('upgrade current plan to BUSINESS via PayTR chain', async () => {
    const { api: adminApi, user: adminUser } = await loginAsApi('admin');
    const { api: superApi } = await loginAsSuperAdmin();
    let restorePlanName: PlanName | null = null;
    let subscriptionId: string | null = null;

    try {
      const before = await (await adminApi.get('subscriptions/current')).json();
      subscriptionId = before.id;
      const startPlan: PlanName = before.plan.name;

      // Demo is effectively pinned on BUSINESS. Skip with explanation —
      // there is no higher-priced tier to upgrade to.
      test.skip(
        startPlan === 'BUSINESS',
        `demo tenant is on BUSINESS (top tier); no upgrade target available`,
      );

      restorePlanName = startPlan;

      const targetPlan: PlanName = 'BUSINESS';
      const { merchantOid, provider } = await upgradeViaPayTR(
        adminApi,
        superApi,
        adminUser.id,
        targetPlan,
        'MONTHLY',
      );

      // We started from a paid plan (anything but FREE); upgrades from a
      // paid plan must take the real PayTR rail.
      expect(provider).toBe('PAYTR');
      expect(merchantOid).toBeTruthy();
      expect(merchantOid.length).toBeGreaterThan(0);

      // Subscription state moved.
      const after = await (await adminApi.get('subscriptions/current')).json();
      const targetPlanId = await getPlanIdByName(superApi, targetPlan);
      expect(after.plan.name).toBe(targetPlan);
      expect(after.planId).toBe(targetPlanId);
      expect(after.status).toBe('ACTIVE');

      // Persisted payment row exists with status=SUCCEEDED, matched by
      // the merchant_oid the webhook signed.
      const detail = await (
        await superApi.get(`superadmin/subscriptions/${subscriptionId}`)
      ).json();
      const payments: Array<{
        paytrMerchantOid?: string | null;
        status: string;
      }> = detail.payments ?? [];
      const ours = payments.find((p) => p.paytrMerchantOid === merchantOid);
      expect(ours, 'SubscriptionPayment row for our merchantOid').toBeTruthy();
      expect(ours!.status).toBe('SUCCEEDED');
    } finally {
      // Restore baseline so subsequent specs see the demo's original plan.
      if (restorePlanName && subscriptionId) {
        try {
          const live = await (await adminApi.get('subscriptions/current')).json();
          if (live.plan.name !== restorePlanName) {
            const originalPlanId = await getPlanIdByName(superApi, restorePlanName);
            await forceDowngrade(superApi, subscriptionId, originalPlanId);
          }
        } catch {
          // Cleanup best-effort — surface the original test failure rather
          // than a cleanup throw.
        }
      }
      await adminApi.dispose();
    }
  });
});
