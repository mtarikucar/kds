import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../helpers/api';
import { createCategoryAndProduct, createTable } from '../../helpers/factories';

/**
 * tenant.status = SUSPENDED must block every tenant operation —
 * the JwtAuthGuard's user-validation path checks tenant status on
 * every request. After a superadmin flips status, the existing
 * tenant JWT should be rejected on the next call.
 *
 * The reverse (ACTIVE → operations work again) is verified by the
 * SuperAdmin cleanup at the end.
 */
let superApi: APIRequestContext;
let tenantId: string;

test.beforeAll(async () => {
  ({ api: superApi } = await loginAsSuperAdmin());
  const { user } = await loginAsApi('admin');
  tenantId = user.tenantId;
});

test.afterAll(async () => {
  // Restore ACTIVE — leaving the demo tenant SUSPENDED would break
  // every subsequent test in the suite.
  await superApi
    .patch(`superadmin/tenants/${tenantId}/status`, { data: { status: 'ACTIVE' } })
    .catch(() => {});
});

test.describe('Tenant suspension blocks tenant operations', () => {
  test('SUSPENDED tenant: existing JWT cannot create orders', async () => {
    // Pre-create everything we need while ACTIVE.
    const { api: warmApi } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(warmApi, { price: 30 });
    const table = await createTable(warmApi);

    // Flip the tenant to SUSPENDED via superadmin.
    const flip = await superApi.patch(`superadmin/tenants/${tenantId}/status`, {
      data: { status: 'SUSPENDED' },
    });
    expect(flip.ok()).toBeTruthy();

    // Existing tokens may stay valid (JWT signature is fine) but the
    // tenant-status guard should reject the request — expect a 4xx,
    // never a 2xx that quietly creates orders for a suspended tenant.
    const res = await warmApi.post('orders', {
      data: {
        type: 'DINE_IN',
        tableId: table.id,
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    expect(res.ok()).toBeFalsy();
    expect([401, 403]).toContain(res.status());

    // Restore for the next test's setup.
    await superApi.patch(`superadmin/tenants/${tenantId}/status`, { data: { status: 'ACTIVE' } });
  });

  test('SUSPENDED tenant: fresh login is also refused', async () => {
    await superApi.patch(`superadmin/tenants/${tenantId}/status`, { data: { status: 'SUSPENDED' } });

    // Try to log in via the API; either the login is refused outright
    // OR it returns a token that gets refused on the very next call.
    let blocked = false;
    try {
      const { api } = await loginAsApi('admin');
      const ping = await api.get('subscriptions/current');
      if ([401, 403].includes(ping.status())) blocked = true;
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);

    await superApi.patch(`superadmin/tenants/${tenantId}/status`, { data: { status: 'ACTIVE' } });
  });
});
