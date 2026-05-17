import { test, expect } from '../../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../../helpers/api';
import { switchTenantPlan, clearFeatureOverrides } from '../../../helpers/plans';

/**
 * Plan tier = FREE
 *
 * FREE has every premium flag turned OFF — only `kdsIntegration` is
 * granted. The admin Sidebar's `requiredFeature`-gated links therefore
 * must all disappear: Reservations, Personnel, Stock, Reports. We
 * also keep the (api-level) feature matrix in
 * subscriptions/plan-tier-matrix.spec.ts; this file asserts the
 * *browser surface* — i.e. the nav rendered by Sidebar.tsx — actually
 * tracks the plan flags.
 *
 * IMPORTANT: the demo tenant has accumulated state (770+ tables, 784+
 * products) which exceeds FREE caps (5 tables, 25 products, etc.). The
 * superadmin plan-change handler refuses such a downgrade. We treat
 * that refusal as a precondition skip — the gate behavior under FREE
 * is well-defined but unreachable in this DB state. Restoring takes the
 * opposite direction so it never fails on this branch.
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
    const switched = await switchTenantPlan(superApi, tenantId, 'FREE');
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

test.describe('Plan tier = FREE — sidebar baseline', () => {
  test('Reservations nav link is absent', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to FREE refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/reservations"]')).toHaveCount(0);
  });

  test('Personnel nav link is absent', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to FREE refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/personnel"]')).toHaveCount(0);
  });

  test('Stock nav link is absent (inventoryTracking=false on FREE)', async ({ adminPage }) => {
    test.skip(switchFailed !== null, `plan switch to FREE refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    await expect(adminPage.locator('a[href$="/admin/stock"]')).toHaveCount(0);
  });

  test('Reports nav link is absent in sidebar (advancedReports=false on FREE)', async ({
    adminPage,
  }) => {
    test.skip(switchFailed !== null, `plan switch to FREE refused: ${switchFailed}`);
    await adminPage.goto('dashboard');
    await adminPage.reload();
    // Scope to sidebar/nav — dashboard cards may keep an unrelated
    // shortcut to /admin/reports outside the plan-gated nav list.
    const sidebarLinks = adminPage.locator(
      'aside a[href$="/admin/reports"], nav a[href$="/admin/reports"]',
    );
    await expect(sidebarLinks).toHaveCount(0);
  });
});
