import { test, expect } from '../../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { switchTenantPlan, clearFeatureOverrides } from '../../../helpers/plans';

/**
 * Plan tier = BUSINESS
 *
 * BUSINESS has every flag ON (including `apiAccess` which PRO lacks)
 * and unlimited caps (-1) — so the demo tenant's accumulated state
 * always fits and the switch never skips. We verify every premium
 * sidebar link is visible AND that the BUSINESS-only Integrations
 * settings page (apiAccess gate) is reachable.
 *
 * If the demo tenant is already on BUSINESS, switchTenantPlan returns
 * a no-op restore() and the asserts still run against the live state.
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
    const switched = await switchTenantPlan(superApi, tenantId, 'BUSINESS');
    restoreOriginal = switched.restore;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // BUSINESS has no caps so this should never trip; record + skip
    // anyway for parity with the other tier files.
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

test.describe('Plan tier = BUSINESS — full premium surface', () => {
  test('Reservations nav link is visible', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/reservations"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Personnel nav link is visible', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/personnel"]')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Stock nav link is visible', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/stock"]')).toBeVisible({ timeout: 15_000 });
  });

  test('Reports nav link is visible in sidebar', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    const sidebarLinks = adminPage.locator(
      'aside a[href$="/admin/reports"], nav a[href$="/admin/reports"]',
    );
    await expect(sidebarLinks.first()).toBeVisible({ timeout: 15_000 });
  });

  test('Reservations route navigates via sidebar click', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await adminPage.locator('a[href$="/admin/reservations"]').first().click();
    await expect(adminPage).toHaveURL(/\/admin\/reservations/, { timeout: 15_000 });
  });

  test('Stock route navigates via sidebar click', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await adminPage.locator('a[href$="/admin/stock"]').first().click();
    await expect(adminPage).toHaveURL(/\/admin\/stock/, { timeout: 15_000 });
  });

  test('API access: Integrations settings page is reachable (apiAccess=true only on BUSINESS)', async ({
    adminPage,
  }) => {
    test.skip(switchFailed !== null, `plan switch to BUSINESS refused: ${switchFailed}`);
    // /admin/settings/integrations is the apiAccess-gated probe route
    // (see FEATURE_PROBE_ROUTES in helpers/plans.ts). On BUSINESS it
    // must load cleanly; on lower tiers the backend 403s the data call
    // and the page degrades.
    await adminPage.goto('admin/settings/integrations');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/integrations/, { timeout: 15_000 });
    // The settings-layout subnav stays visible regardless, but the
    // page body should not show a hard error toast / banner.
    await expect(adminPage.locator('text=/403|forbidden|not authorised|yetkisiz/i')).toHaveCount(0);
  });
});
