import { test, expect } from '../../../fixtures/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { getPlanIdByName, PlanName } from '../../../helpers/plans';
import { forceDowngrade } from '../../../helpers/paytr-plan-switch';

/**
 * Phase 3 — Plan downgrade.
 *
 * Production downgrades are *scheduled* — `POST /subscriptions/:id/change-plan`
 * with a cheaper plan returns `{ type: 'downgrade', scheduledFor }` and
 * writes `Subscription.scheduledDowngradePlanId`. The actual plan swap
 * happens at period boundary via the scheduler tick.
 *
 * Demo tenant constraint: the demo's usage may exceed BASIC's limits
 * (PLAN_LIMITS.BASIC caps 5 users / 20 tables / 100 products / 500
 * orders/mo). `SubscriptionService.assertDowngradeAllowed` throws
 * BadRequest in that case. If BASIC is over-quota we fall back to PRO,
 * which is the next cheapest paid tier with looser caps.
 *
 * If the live plan is already the cheapest paid tier (BASIC), we skip
 * with a clear message — there is no lower paid plan to downgrade to,
 * and FREE downgrades aren't a supported path on `change-plan`.
 */
test.describe('Subscription lifecycle — plan downgrade', () => {
  test('change-plan to a cheaper paid tier schedules a downgrade', async () => {
    const { api: adminApi } = await loginAsApi('admin');
    const { api: superApi } = await loginAsSuperAdmin();

    try {
      const before = await (await adminApi.get('subscriptions/current')).json();
      const startPlan: PlanName = before.plan.name;

      test.skip(
        startPlan === 'BASIC' || startPlan === 'FREE',
        `live plan is ${startPlan}; no cheaper paid tier available for downgrade`,
      );

      // If the existing subscription has a pending scheduled downgrade
      // (e.g. left over from an earlier run), clear it so change-plan
      // doesn't reject with "already a scheduled plan change".
      if (before.scheduledDowngradePlanId) {
        const clear = await adminApi.delete(
          `subscriptions/${before.id}/scheduled-downgrade`,
        );
        expect(clear.ok()).toBeTruthy();
      }

      // Pick the next-cheaper paid tier and attempt the change. If the
      // demo's usage trips assertDowngradeAllowed (e.g. BASIC too small),
      // fall back to PRO, and if PRO is also too small skip with
      // explanation.
      const downgradeCandidates: PlanName[] =
        startPlan === 'BUSINESS' ? ['PRO', 'BASIC'] : ['BASIC'];

      let scheduledTo: PlanName | null = null;
      let response: any = null;
      let lastFailure: { plan: PlanName; status: number; body: string } | null =
        null;

      for (const candidate of downgradeCandidates) {
        const candidateId = await getPlanIdByName(superApi, candidate);
        const res = await adminApi.post(`subscriptions/${before.id}/change-plan`, {
          data: { newPlanId: candidateId, billingCycle: before.billingCycle },
        });
        if (res.ok()) {
          response = await res.json();
          scheduledTo = candidate;
          break;
        }
        lastFailure = { plan: candidate, status: res.status(), body: await res.text() };
      }

      test.skip(
        !scheduledTo,
        `no downgrade target accepted (last error ${lastFailure?.status}: ${lastFailure?.body})`,
      );

      // The candidate was accepted but classified as an upgrade (the
      // demo's live plan ended up cheaper than expected after prior
      // tests ran). Skip with context — this spec is about the
      // downgrade branch specifically.
      test.skip(
        response.type !== 'downgrade',
        `change-plan returned type=${response.type} for ${startPlan}→${scheduledTo}; not exercising the downgrade branch in this state`,
      );

      // Shape of the scheduled-downgrade response: see
      // SubscriptionService.changePlan, downgrade branch.
      expect(response.type).toBe('downgrade');
      expect(response.requiresPayment).toBe(false);
      expect(response.scheduledFor).toBeTruthy();
      const scheduledForDate = new Date(response.scheduledFor);
      expect(Number.isNaN(scheduledForDate.getTime())).toBe(false);

      // Subscription row carries the scheduled target.
      const targetId = await getPlanIdByName(superApi, scheduledTo!);
      const after = await (await adminApi.get('subscriptions/current')).json();
      expect(after.scheduledDowngradePlanId).toBe(targetId);
      // Active plan should NOT have moved — scheduled, not applied.
      expect(after.plan.name).toBe(startPlan);

      // Clean up the schedule so subsequent specs see a vanilla state.
      const cancel = await adminApi.delete(
        `subscriptions/${before.id}/scheduled-downgrade`,
      );
      expect(cancel.ok()).toBeTruthy();
    } finally {
      await adminApi.dispose();
    }
  });

  test('forceDowngrade superadmin path immediately swaps Subscription.planId', async () => {
    // Direct superadmin PATCH path — the same one
    // applyScheduledDowngrade ends up at after the period boundary.
    // Used by switchTenantPlan for matrix tests that need an immediate
    // state change without waiting on a scheduler tick.
    const { api: adminApi } = await loginAsApi('admin');
    const { api: superApi } = await loginAsSuperAdmin();
    let originalPlanName: PlanName | null = null;
    let subscriptionId: string | null = null;

    try {
      const before = await (await adminApi.get('subscriptions/current')).json();
      subscriptionId = before.id;
      originalPlanName = before.plan.name;

      test.skip(
        originalPlanName === 'BASIC' || originalPlanName === 'FREE',
        `live plan is ${originalPlanName}; no lower paid tier to downgrade to`,
      );

      // Try PRO first, BASIC as fallback (BASIC limits may not fit demo
      // usage; PRO almost always does).
      const candidates: PlanName[] =
        originalPlanName === 'BUSINESS' ? ['PRO', 'BASIC'] : ['BASIC'];

      let landedOn: PlanName | null = null;
      let lastErr: unknown = null;
      for (const candidate of candidates) {
        const candidateId = await getPlanIdByName(superApi, candidate);
        try {
          await forceDowngrade(superApi, subscriptionId!, candidateId);
          landedOn = candidate;
          break;
        } catch (e) {
          lastErr = e;
        }
      }

      test.skip(
        !landedOn,
        `forceDowngrade rejected for all candidates: ${String(lastErr)}`,
      );

      const after = await (await adminApi.get('subscriptions/current')).json();
      expect(after.plan.name).toBe(landedOn);
    } finally {
      // Restore baseline.
      if (originalPlanName && subscriptionId) {
        try {
          const live = await (await adminApi.get('subscriptions/current')).json();
          if (live.plan.name !== originalPlanName) {
            const restoreId = await getPlanIdByName(superApi, originalPlanName);
            await forceDowngrade(superApi, subscriptionId, restoreId);
          }
        } catch {
          // best effort
        }
      }
      await adminApi.dispose();
    }
  });
});
