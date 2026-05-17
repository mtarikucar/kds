import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';

/**
 * Phase 1 — Initial activation.
 *
 * The demo tenant boots into a live subscription (ACTIVE or TRIALING)
 * already pinned to a paid plan. This phase only verifies the *read*
 * surface that downstream lifecycle specs depend on:
 *
 *   - GET /subscriptions/current returns the live row with planId,
 *     status, currentPeriodEnd.
 *   - GET /subscriptions/plans exposes the catalog (used by
 *     paytr-plan-switch.upgradeViaPayTR to resolve the target plan).
 *
 * The "FREE plan rejects create-intent" assertion is intentionally not
 * duplicated here — it's already covered in
 * tests/e2e/specs/subscriptions/free-plan-rejection.spec.ts, the same
 * file the task references. Re-asserting would be redundant noise.
 */
test.describe('Subscription lifecycle — initial activation', () => {
  test('demo tenant has a live subscription with the expected shape', async () => {
    const { api } = await loginAsApi('admin');
    try {
      const res = await api.get('subscriptions/current');
      expect(res.ok()).toBeTruthy();
      const sub = await res.json();

      // Shape contract relied on by paytr-plan-switch helper + every
      // subsequent lifecycle spec.
      expect(sub.id).toBeTruthy();
      expect(['ACTIVE', 'TRIALING', 'PAST_DUE']).toContain(sub.status);
      expect(sub.planId).toBeTruthy();
      expect(sub.plan?.name).toBeTruthy();
      expect(sub.plan?.id).toBe(sub.planId);
      expect(sub.currentPeriodEnd).toBeTruthy();
      // currentPeriodEnd must be a parseable ISO date in the future.
      const periodEnd = new Date(sub.currentPeriodEnd);
      expect(Number.isNaN(periodEnd.getTime())).toBe(false);
      expect(periodEnd.getTime()).toBeGreaterThan(Date.now());
      expect(['MONTHLY', 'YEARLY']).toContain(sub.billingCycle);
    } finally {
      await api.dispose();
    }
  });

  test('plan catalog is reachable and contains the four canonical plans', async () => {
    const { api } = await loginAsApi('admin');
    try {
      const res = await api.get('subscriptions/plans');
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      const plans: Array<{ name: string }> = Array.isArray(body)
        ? body
        : body.data ?? body.items ?? [];
      const names = plans.map((p) => p.name).sort();
      // Every paid lifecycle path resolves targets out of this catalog.
      expect(names).toEqual(expect.arrayContaining(['FREE', 'BASIC', 'PRO', 'BUSINESS']));
    } finally {
      await api.dispose();
    }
  });

  // Note: FREE→create-intent rejection (400) is covered by
  // tests/e2e/specs/subscriptions/free-plan-rejection.spec.ts. Not
  // duplicated here on purpose.
});
