import { test, expect } from '../../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { switchTenantPlan, clearFeatureOverrides } from '../../../helpers/plans';

/**
 * Plan tier = BASIC
 *
 * BASIC flips `inventoryTracking` ON (Stock link should reappear vs
 * FREE) but leaves the rest of the premium flags OFF: no Reservations,
 * no Personnel, no advancedReports.
 *
 * Demo-tenant accumulation almost certainly exceeds BASIC caps (max 20
 * tables / 100 products vs the seed's 770+/784+), so the precondition
 * usually skips — same handling as plan-tier-matrix.spec.ts.
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
    const switched = await switchTenantPlan(superApi, tenantId, 'BASIC');
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

test.describe('Plan tier = BASIC — sidebar surface', () => {
  test('Stock nav link is visible (inventoryTracking=true on BASIC)', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BASIC refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/stock"]')).toBeVisible({ timeout: 15_000 });
  });

  test('Reservations nav link remains absent (reservationSystem=false on BASIC)', async ({
    adminPage,
  }) => {
    test.skip(switchFailed !== null, `plan switch to BASIC refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/reservations"]')).toHaveCount(0);
  });

  test('Personnel nav link remains absent (personnelManagement=false on BASIC)', async ({
    adminPage,
  }) => {
    test.skip(switchFailed !== null, `plan switch to BASIC refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/personnel"]')).toHaveCount(0);
  });

  test('Reports nav link remains absent in sidebar (advancedReports=false on BASIC)', async ({
    adminPage,
  }) => {
    test.skip(switchFailed !== null, `plan switch to BASIC refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    const sidebarLinks = adminPage.locator(
      'aside a[href$="/admin/reports"], nav a[href$="/admin/reports"]',
    );
    await expect(sidebarLinks).toHaveCount(0);
  });
});
