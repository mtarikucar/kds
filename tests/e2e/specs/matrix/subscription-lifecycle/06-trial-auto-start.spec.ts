import { test, expect } from '../../../fixtures/test';
import { loginAsSuperAdmin } from '../../../helpers/api';
import { registerFreshTenant } from '../../../helpers/fresh-tenant';
import { FEATURE_PROBE_ROUTES } from '../../../helpers/plans';

/**
 * Trial auto-start — every newly registered restaurant gets a 14-day
 * BUSINESS trial at zero charge. Verifies the three things that have
 * to land together for that to actually work:
 *
 *   1. Subscription row is created on BUSINESS with status=TRIALING.
 *   2. All BUSINESS feature gates open immediately (PlanFeatureGuard
 *      reads `currentPlan[feature]` and currentPlan is BUSINESS).
 *   3. Trial expiry drops the tenant to FREE; gates close again.
 *
 * Each test mints its own throwaway tenant via /auth/register because
 * the demo tenant has its trial fields pre-stamped (BUSINESS without
 * isTrialPeriod=true) and is shared across the matrix; touching it
 * would cascade into dozens of unrelated specs.
 */
test.describe('Subscription lifecycle — trial auto-start at registration', () => {
  test('new tenant boots into TRIALING BUSINESS for 14 days', async () => {
    const fresh = await registerFreshTenant('auto-start');
    try {
      const res = await fresh.api.get('subscriptions/current');
      expect(res.ok()).toBeTruthy();
      const sub = await res.json();

      expect(sub.plan.name).toBe('BUSINESS');
      expect(sub.status).toBe('TRIALING');
      expect(sub.isTrialPeriod).toBe(true);
      expect(sub.trialStart).toBeTruthy();
      expect(sub.trialEnd).toBeTruthy();

      // Trial window: ~14 days from now. Allow a 30s skew either side
      // for clock drift between request issuance and DB write.
      const trialEnd = new Date(sub.trialEnd).getTime();
      const now = Date.now();
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;
      expect(trialEnd - now).toBeGreaterThan(fourteenDays - 30_000);
      expect(trialEnd - now).toBeLessThan(fourteenDays + 30_000);
    } finally {
      await fresh.api.dispose();
    }
  });

  test('trial opens every BUSINESS-tier feature gate', async () => {
    const fresh = await registerFreshTenant('full-features');
    try {
      // PlanFeatureGuard reads tenant.currentPlanId and returns 2xx
      // when currentPlan[feature]=true. BUSINESS has every feature on,
      // so every probe in the matrix should be allowed.
      for (const probe of FEATURE_PROBE_ROUTES) {
        const res = await fresh.api.get(probe.path);
        expect(
          res.status(),
          `Expected ${probe.feature} open during BUSINESS trial but got ${res.status()}: ${await res.text()}`,
        ).toBeLessThan(403);
      }
    } finally {
      await fresh.api.dispose();
    }
  });

  test('trial expiry drops tenant to FREE and closes premium gates', async () => {
    const fresh = await registerFreshTenant('expiry');
    const { api: superApi } = await loginAsSuperAdmin();
    try {
      // 1. Find the subscription id (we only have user.tenantId from
      //    register; ask /subscriptions/current for the row).
      const beforeRes = await fresh.api.get('subscriptions/current');
      expect(beforeRes.ok()).toBeTruthy();
      const before = await beforeRes.json();
      expect(before.status).toBe('TRIALING');
      const subscriptionId: string = before.id;

      // 2. Pull trialEnd into the past so the expireTrials sweep picks
      //    this row up. The superadmin update endpoint accepts trialEnd
      //    as an ISO string.
      const past = new Date(Date.now() - 60_000).toISOString();
      const patch = await superApi.patch(`superadmin/subscriptions/${subscriptionId}`, {
        data: { trialEnd: past },
      });
      expect(patch.ok()).toBeTruthy();

      // 3. Run the expiry sweep manually (same code path as the
      //    nightly cron; surfaced via /superadmin/subscriptions/expire-trials).
      const sweep = await superApi.post('superadmin/subscriptions/expire-trials');
      expect(sweep.ok()).toBeTruthy();
      const sweepBody = await sweep.json();
      expect(sweepBody.processed).toBeGreaterThanOrEqual(1);

      // 4. Subscription is now ACTIVE FREE, isTrialPeriod off.
      const afterRes = await fresh.api.get('subscriptions/current');
      expect(afterRes.ok()).toBeTruthy();
      const after = await afterRes.json();
      expect(after.plan.name).toBe('FREE');
      expect(after.status).toBe('ACTIVE');
      expect(after.isTrialPeriod).toBe(false);

      // 5. FREE has reservationSystem=false; the gate should close.
      const reservationsRes = await fresh.api.get('reservations');
      expect(reservationsRes.status()).toBe(403);
    } finally {
      await fresh.api.dispose();
    }
    // Superadmin context is cached process-wide via loginAsSuperAdmin —
    // no per-test dispose needed; the next spec reuses the same context.
  });
});
