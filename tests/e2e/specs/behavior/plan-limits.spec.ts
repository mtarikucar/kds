import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../helpers/api';
import { createTable } from '../../helpers/factories';

/**
 * Plan limits live on SubscriptionPlan + are overridable per tenant
 * via Tenant.limitOverrides. With the demo tenant on BUSINESS
 * (every limit = -1 unlimited) we use the override to install a
 * tight cap and verify the create endpoint refuses past the cap.
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
    .patch(`superadmin/tenants/${tenantId}/overrides`, { data: { limitOverrides: {} } })
    .catch(() => {});
  // Cached superadmin context is shared across files; don't dispose.
});

async function setLimit(key: string, value: number | null): Promise<void> {
  // Pass `null` to delete the override (the DTO whitelist drops
  // keys whose value is null/undefined). The DTO refuses negatives,
  // so we cannot use `-1` as the "unlimited" sentinel.
  const res = await superApi.patch(`superadmin/tenants/${tenantId}/overrides`, {
    data: { limitOverrides: { [key]: value } },
  });
  if (!res.ok()) throw new Error(`limit set failed: ${res.status()} ${await res.text()}`);
}

test.describe('Plan limits → CheckLimit guard refuses past the cap', () => {
  test('maxTables override caps new-table creation', async () => {
    // Count current tables, then install a limit at current+1.
    const { api } = await loginAsApi('admin');
    const existing = await (await api.get('tables')).json();
    const currentCount = Array.isArray(existing) ? existing.length : existing.items?.length ?? 0;

    await setLimit('maxTables', currentCount + 1);

    // The one allowed slot should succeed.
    const okTable = await createTable(api).catch((e) => e);
    expect(okTable).not.toBeInstanceOf(Error);

    // The next attempt must be refused by the CheckLimit guard.
    const refused = await api.post('tables', {
      data: { number: `OVER${Date.now()}`, capacity: 2 },
    });
    expect([400, 403]).toContain(refused.status());

    // Reset: delete the override so subsequent specs see unlimited.
    await setLimit('maxTables', null);
  });
});
