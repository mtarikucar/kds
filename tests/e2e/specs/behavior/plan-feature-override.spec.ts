import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../helpers/api';

/**
 * Plan feature gate behaviour — the BUSINESS plan has everything
 * on, so to test the OFF path we have to use the superadmin
 * featureOverrides escape hatch. Each test flips a single feature
 * off, hits a route gated by it, expects 403, then resets the
 * override so later tests start clean.
 *
 * One superadmin login per file (TOTP-replay constraint).
 */
let superApi: APIRequestContext;
let tenantId: string;

test.beforeAll(async () => {
  ({ api: superApi } = await loginAsSuperAdmin());
  const { user } = await loginAsApi('admin');
  tenantId = user.tenantId;
});

test.afterAll(async () => {
  // Reset overrides to plan-default. Do NOT dispose — the superadmin
  // API context is module-level cached for the whole worker.
  await superApi
    .patch(`superadmin/tenants/${tenantId}/overrides`, { data: { featureOverrides: {} } })
    .catch(() => {});
});

async function setOverride(features: Record<string, boolean>): Promise<void> {
  const res = await superApi.patch(`superadmin/tenants/${tenantId}/overrides`, {
    data: { featureOverrides: features },
  });
  if (!res.ok()) throw new Error(`override failed: ${res.status()} ${await res.text()}`);
}

test.describe('Plan features → OFF blocks the gated routes', () => {
  test('reservationSystem=false → /reservations returns 403', async () => {
    await setOverride({ reservationSystem: false });
    const { api } = await loginAsApi('admin');
    const res = await api.get('reservations');
    expect(res.status()).toBe(403);

    // Reset for the next test.
    await setOverride({});
    const after = await (await loginAsApi('admin')).api.get('reservations');
    expect(after.ok()).toBeTruthy();
  });

  test('personnelManagement=false → /personnel/attendance/today returns 403', async () => {
    await setOverride({ personnelManagement: false });
    const { api } = await loginAsApi('admin');
    const res = await api.get('personnel/attendance/today');
    expect(res.status()).toBe(403);

    await setOverride({});
  });

  test('inventoryTracking=false → /stock-management/items returns 403', async () => {
    await setOverride({ inventoryTracking: false });
    const { api } = await loginAsApi('admin');
    const res = await api.get('stock-management/items');
    expect(res.status()).toBe(403);

    await setOverride({});
  });
});
