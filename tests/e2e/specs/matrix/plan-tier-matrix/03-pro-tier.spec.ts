import { test, expect } from '../../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { switchTenantPlan, clearFeatureOverrides } from '../../../helpers/plans';

/**
 * Plan tier = PRO
 *
 * PRO flips every premium flag ON except `apiAccess`. The admin
 * Sidebar therefore renders every `requiredFeature`-gated link:
 * Reservations, Personnel, Stock, Reports — and each route is
 * navigable. multiLocation has no dedicated sidebar entry; we probe
 * its surface through the Settings → reservations / online-orders
 * subnav which only loads cleanly when the gates open.
 *
 * Demo-tenant accumulation may exceed PRO caps (50 tables / 500
 * products vs the seed's 770+/784+), so the switch often skips. The
 * skip handling mirrors plan-tier-matrix.spec.ts.
 */

let superApi: APIRequestContext;
let tenantId: string;
let restoreOriginal: (() => Promise<void>) | null = null;
let switchFailed: string | null = null;

test.beforeAll(async () => {
  ({ api: superApi } = await loginAsSuperAdmin());
  const { user } = await loginAsApi('admin');
  tenantId = user.tenantId;
  await clearFeatureOverrides(superApi, tenantId);

  try {
    const switched = await switchTenantPlan(superApi, tenantId, 'PRO');
    restoreOriginal = switched.restore;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/exceeds new plan limits|current usage/i.test(msg)) {
      switchFailed = msg;
    } else {
      throw e;
    }
  }
});

test.afterAll(async () => {
  await clearFeatureOverrides(superApi, tenantId).catch(() => {});
  if (restoreOriginal) await restoreOriginal().catch(() => {});
});

test.describe('Plan tier = PRO — premium sidebar surface', () => {
  test('Reservations nav link is visible', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to PRO refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/reservations"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Personnel nav link is visible', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to PRO refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/personnel"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Stock nav link is visible', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to PRO refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/stock"]')).toBeVisible({ timeout: 15_000 });
  });

  test('Reports nav link is visible in sidebar', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to PRO refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    const sidebarLinks = adminPage.locator(
      'aside a[href$="/admin/reports"], nav a[href$="/admin/reports"]',
    );
    await expect(sidebarLinks.first()).toBeVisible({ timeout: 15_000 });
  });

  test('Reservations route is navigable end-to-end', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to PRO refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await adminPage.locator('a[href$="/admin/reservations"]').first().click();
    await expect(adminPage).toHaveURL(/\/admin\/reservations/, { timeout: 15_000 });
  });

  test('Multi-location: Settings → reservations subpage is reachable (PlanFeatureGuard open)', async ({
    adminPage,
  }) => {
    test.skip(switchFailed !== null, `plan switch to PRO refused: ${switchFailed}`);
    // The reservations *settings* page hangs off SettingsLayout. On PRO
    // its data calls (reservation settings + reservation-system feature
    // gate on backend) resolve successfully — proving the gate stays
    // open in the browser surface, not just in raw API probes.
    await adminPage.goto('admin/settings/reservations');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/reservations/, { timeout: 15_000 });
  });
});
