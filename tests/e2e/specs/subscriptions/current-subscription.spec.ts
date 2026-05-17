import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';

test.describe('Subscriptions — tenant-facing reads', () => {
  test('GET /subscriptions/current returns the active subscription', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('subscriptions/current');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toMatch(/ACTIVE|TRIALING|PAST_DUE/);
    expect(body.plan).toBeTruthy();
    expect(body.plan.name).toBeTruthy();
  });

  test('GET /subscriptions/effective-features returns merged plan + override map', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('subscriptions/effective-features');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Demo tenant is on BUSINESS plan; every feature flag is true.
    expect(body.features.inventoryTracking).toBe(true);
    expect(body.features.reservationSystem).toBe(true);
    expect(body.features.advancedReports).toBe(true);
    // Limits are -1 (unlimited) on the BUSINESS plan.
    expect(body.limits.maxUsers).toBe(-1);
    // Trial-eligible plan ids surface here for the "free trial" CTA.
    expect(Array.isArray(body.trialEligiblePlanIds)).toBe(true);
  });

  test('GET /subscriptions/plans lists at least the four seed plans', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.get('subscriptions/plans');
    expect(res.ok()).toBeTruthy();
    const plans = await res.json();
    expect(Array.isArray(plans)).toBeTruthy();
    const names = plans.map((p: any) => p.name);
    for (const expected of ['FREE', 'BASIC', 'PRO', 'BUSINESS']) {
      expect(names).toContain(expected);
    }
  });

  test('WAITER cannot read /subscriptions/current (role-gated)', async () => {
    const { api } = await loginAsApi('waiter');
    const res = await api.get('subscriptions/current');
    expect([401, 403]).toContain(res.status());
  });
});
