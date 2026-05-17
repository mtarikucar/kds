import { test, expect } from '../../../fixtures/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { attemptUpgradeWithFailure } from '../../../helpers/paytr-plan-switch';
import { PlanName } from '../../../helpers/plans';

/**
 * Phase 5 — Failed payment.
 *
 * Drives `attemptUpgradeWithFailure` which mints a real intent and then
 * delivers a `status=failed` webhook. After this returns we assert:
 *
 *   - a SubscriptionPayment row exists for the merchantOid with
 *     status=FAILED and the simulator's failureMessage echoed back
 *   - Subscription.planId did NOT change (the webhook's applyFailure
 *     path never touches the plan)
 *
 * Demo tenant constraint: same as 02-plan-upgrade — if the live plan is
 * already BUSINESS there is no higher tier to attempt, so we skip with
 * a clear message. No cleanup is needed: the failed branch is a no-op
 * on subscription state, so the tenant is already in its prior plan.
 */
test.describe('Subscription lifecycle — failed payment', () => {
  test('failed PayTR webhook records FAILED payment and leaves plan unchanged', async () => {
    const { api: adminApi, user: adminUser } = await loginAsApi('admin');
    const { api: superApi } = await loginAsSuperAdmin();

    try {
      const before = await (await adminApi.get('subscriptions/current')).json();
      const startPlanName: PlanName = before.plan.name;
      const startPlanId: string = before.planId;

      test.skip(
        startPlanName === 'BUSINESS',
        `demo tenant is on BUSINESS (top tier); no upgrade target to fail against`,
      );

      const target: PlanName = 'BUSINESS';

      const { merchantOid } = await attemptUpgradeWithFailure(
        adminApi,
        superApi,
        adminUser.id,
        target,
        'MONTHLY',
      );
      expect(merchantOid).toBeTruthy();

      // SubscriptionPayment row should be FAILED with the simulator's
      // failure message echoed by paytr-webhook.controller.applyFailure.
      const detail = await (
        await superApi.get(`superadmin/subscriptions/${before.id}`)
      ).json();
      const payments: Array<{
        paytrMerchantOid?: string | null;
        status: string;
        failureMessage?: string | null;
      }> = detail.payments ?? [];
      const ours = payments.find((p) => p.paytrMerchantOid === merchantOid);
      expect(ours, 'SubscriptionPayment row for failed merchantOid').toBeTruthy();
      expect(ours!.status).toBe('FAILED');
      // The simulator sends "card declined (test)" — applyFailure persists
      // it verbatim into failureMessage.
      expect(ours!.failureMessage ?? '').toMatch(/card declined/i);

      // Subscription planId must not have moved — failure path doesn't
      // touch the subscription, just the payment row.
      const after = await (await adminApi.get('subscriptions/current')).json();
      expect(after.planId).toBe(startPlanId);
      expect(after.plan.name).toBe(startPlanName);
    } finally {
      // No cleanup: the failed-payment branch is a no-op on subscription
      // state, so the tenant is already on its original plan.
      await adminApi.dispose();
    }
  });
});
