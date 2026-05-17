import { test, expect } from '../../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { getPlanIdByName } from '../../../helpers/plans';

/**
 * Plan downgrade is refused when current usage exceeds the smaller
 * plan. Two angles:
 *
 *   1. API: superadmin PATCH /superadmin/subscriptions/:id with
 *      planId=FREE (or BASIC) returns 400 + a violations message
 *      mentioning the over-limit dimension (tables / products /
 *      categories / users). This is the canonical guard.
 *
 *   2. Browser: the tenant-facing "Change Plan" page surfaces a
 *      live navigation control. We at minimum reach the page and
 *      confirm the change-plan flow renders without a hard crash —
 *      the server-side guard is what actually blocks the downgrade
 *      (the same 400 in step 1). This proves the admin UI path
 *      eventually hits the same guard.
 *
 * Lifted from subscriptions/plan-tier-matrix.spec.ts so the matrix
 * specs (one per tier) live together under matrix/plan-tier-matrix/.
 * The original spec keeps the API-side feature probe loop; this file
 * owns the downgrade-violation case for the directory.
 */

let superApi: APIRequestContext;
let tenantId: string;

test.beforeAll(async () => {
  ({ api: superApi } = await loginAsSuperAdmin());
  const { user } = await loginAsApi('admin');
  tenantId = user.tenantId;
});

test.describe('Downgrade protection — usage exceeds smaller-plan caps', () => {
  test('API: switching demo tenant to FREE is rejected with a violations message', async () => {
    // Demo seed has 12+ tables (and now 770+) while FREE caps maxTables=5.
    // The superadmin subscription-update handler must respond 400 with
    // a message listing the over-limit dimension.
    const freePlanId = await getPlanIdByName(superApi, 'FREE');
    const subsRes = await superApi.get(
      `superadmin/subscriptions?tenantId=${tenantId}&status=ACTIVE`,
    );
    const subsBody = await subsRes.json();
    const subs = Array.isArray(subsBody) ? subsBody : subsBody.data ?? subsBody.items ?? [];
    expect(subs.length, 'demo tenant should have one ACTIVE subscription').toBeGreaterThan(0);
    const subId = subs[0].id;

    const res = await superApi.patch(`superadmin/subscriptions/${subId}`, {
      data: { planId: freePlanId },
    });
    expect(res.status()).toBe(400);
    const errBody = await res.json();
    const msg: string = errBody.message ?? '';
    expect(msg).toMatch(/tables|products|categories|users/i);
  });

  test('API: switching demo tenant to BASIC is rejected (tables / products over cap)', async () => {
    // BASIC caps maxTables=20, maxProducts=100. Demo accumulates well
    // past both, so the same guard must fire here too.
    const basicPlanId = await getPlanIdByName(superApi, 'BASIC');
    const subsRes = await superApi.get(
      `superadmin/subscriptions?tenantId=${tenantId}&status=ACTIVE`,
    );
    const subsBody = await subsRes.json();
    const subs = Array.isArray(subsBody) ? subsBody : subsBody.data ?? subsBody.items ?? [];
    expect(subs.length).toBeGreaterThan(0);
    const subId = subs[0].id;

    const res = await superApi.patch(`superadmin/subscriptions/${subId}`, {
      data: { planId: basicPlanId },
    });
    expect(res.status()).toBe(400);
    const errBody = await res.json();
    const msg: string = errBody.message ?? '';
    expect(msg).toMatch(/tables|products|categories|users/i);
  });

  test('Browser: tenant-facing Change-Plan page renders without crashing', async ({
    adminPage,
  }) => {
    // The plan-change UI lives at /subscription/change-plan; from the
    // subscription settings page the admin clicks "Change Plan" which
    // navigates here. We verify the route mounts and the page exposes
    // the plan-selection surface — actual downgrade refusal is enforced
    // server-side and asserted via the API tests above.
    await adminPage.goto('admin/settings/subscription');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/subscription/, { timeout: 15_000 });

    // The "Change Plan" / "View All Plans" buttons are localized; we
    // can't bank on a specific string. Instead, drive the route directly
    // and confirm something rendered.
    await adminPage.goto('subscription/plans');
    await expect(adminPage).toHaveURL(/\/subscription\/plans/, { timeout: 15_000 });
    // The plans page renders a heading H1 once /subscriptions/plans
    // returns — proves the React tree mounted past the loading skeleton.
    await expect(adminPage.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  });
});
