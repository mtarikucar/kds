import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../helpers/api';

/**
 * Sidebar nav items are gated by PlanFeatures via the
 * `hasFeature()` hook. When a feature flips OFF the link must
 * disappear from the sidebar — clicking it would otherwise hit
 * a 403'd route and confuse the user.
 *
 * Use the superadmin override to flip a feature off, reload the
 * admin browser, assert the link is gone; then reset and assert
 * the link is back.
 */
let superApi: APIRequestContext;
let tenantId: string;

test.beforeAll(async () => {
  ({ api: superApi } = await loginAsSuperAdmin());
  const { user } = await loginAsApi('admin');
  tenantId = user.tenantId;
});

test.afterAll(async () => {
  await superApi
    .patch(`superadmin/tenants/${tenantId}/overrides`, { data: { featureOverrides: {} } })
    .catch(() => {});
});

async function setOverride(features: Record<string, boolean | null>): Promise<void> {
  const res = await superApi.patch(`superadmin/tenants/${tenantId}/overrides`, {
    data: { featureOverrides: features },
  });
  if (!res.ok()) throw new Error(`override: ${res.status()} ${await res.text()}`);
}

/** Pass nulls for every key so reset is explicit and doesn't depend
 *  on the backend iterating FEATURE_KEYS for an empty payload. */
const CLEAR_ALL: Record<string, null> = {
  advancedReports: null,
  multiLocation: null,
  customBranding: null,
  apiAccess: null,
  prioritySupport: null,
  inventoryTracking: null,
  kdsIntegration: null,
  reservationSystem: null,
  personnelManagement: null,
  deliveryIntegration: null,
};

test.describe('Sidebar nav reacts to plan-feature overrides (browser)', () => {
  test('reservationSystem=false hides the Reservations nav link', async ({ adminPage }) => {
    await setOverride({ reservationSystem: false });
    // adminPage was logged in before the override flip; reload so
    // the React-Query subscription cache refetches.
    await adminPage.goto('dashboard');
    await adminPage.reload();

    const link = adminPage.locator('a[href$="/admin/reservations"]');
    await expect(link).toHaveCount(0);

    await setOverride(CLEAR_ALL);
    await adminPage.reload();
    await expect
      .poll(() => adminPage.locator('a[href$="/admin/reservations"]').count(), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(1);
  });

  test('inventoryTracking=false hides the Stock nav link', async ({ adminPage }) => {
    await setOverride({ inventoryTracking: false });
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/stock"]')).toHaveCount(0);

    await setOverride(CLEAR_ALL);
    await adminPage.reload();
    await expect
      .poll(() => adminPage.locator('a[href$="/admin/stock"]').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test('personnelManagement=false hides the Personnel nav link', async ({ adminPage }) => {
    await setOverride({ personnelManagement: false });
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/personnel"]')).toHaveCount(0);

    await setOverride(CLEAR_ALL);
    await adminPage.reload();
    await expect
      .poll(() => adminPage.locator('a[href$="/admin/personnel"]').count(), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test('advancedReports=false hides the Reports nav link', async ({ adminPage }) => {
    await setOverride({ advancedReports: false });
    await adminPage.goto('dashboard');
    await adminPage.reload();
    // Scope to sidebar/nav only — dashboard cards may keep a shortcut
    // to /admin/reports independently of the plan feature flag.
    const sidebarLinks = adminPage.locator(
      'aside a[href$="/admin/reports"], nav a[href$="/admin/reports"]',
    );
    await expect(sidebarLinks).toHaveCount(0);

    await setOverride(CLEAR_ALL);
    await adminPage.reload();
    await expect.poll(() => sidebarLinks.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });
});
