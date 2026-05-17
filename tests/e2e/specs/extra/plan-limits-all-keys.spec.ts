import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsApi, loginAsSuperAdmin } from '../../helpers/api';
import { createCategory, createProduct, createTable } from '../../helpers/factories';

/**
 * Plan limits beyond the maxTables happy path: maxCategories,
 * maxProducts. Each test installs a tight cap via the superadmin
 * override, fills it to the cap, then asserts the (cap+1)th call
 * is refused by the CheckLimit guard.
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
    .patch(`superadmin/tenants/${tenantId}/overrides`, {
      data: {
        limitOverrides: {
          maxUsers: null,
          maxTables: null,
          maxProducts: null,
          maxCategories: null,
          maxMonthlyOrders: null,
        },
      },
    })
    .catch(() => {});
});

async function setLimit(key: string, value: number | null): Promise<void> {
  const res = await superApi.patch(`superadmin/tenants/${tenantId}/overrides`, {
    data: { limitOverrides: { [key]: value } },
  });
  if (!res.ok()) throw new Error(`limit ${key}=${value}: ${res.status()} ${await res.text()}`);
}

test.describe('Plan limits → CheckLimit guard refuses past the cap (per key)', () => {
  test('maxCategories cap blocks new-category create', async () => {
    const { api } = await loginAsApi('admin');
    const list = await (await api.get('menu/categories')).json();
    const current = Array.isArray(list) ? list.length : list.items?.length ?? 0;

    await setLimit('maxCategories', current);
    // We're already AT the cap — next create must fail.
    const refused = await api.post('menu/categories', {
      data: { name: `OVER-${Date.now()}`, displayOrder: 0 },
    });
    expect([400, 403]).toContain(refused.status());

    await setLimit('maxCategories', null);
  });

  test('maxProducts cap blocks new-product create', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const list = await (await api.get('menu/products')).json();
    const current = Array.isArray(list) ? list.length : list.items?.length ?? 0;

    await setLimit('maxProducts', current);
    const refused = await api.post('menu/products', {
      data: {
        name: `OVER-${Date.now()}`,
        price: 1,
        categoryId: cat.id,
        isAvailable: true,
      },
    });
    expect([400, 403]).toContain(refused.status());

    await setLimit('maxProducts', null);
  });

  test('maxTables=0 prevents any new table create', async () => {
    await setLimit('maxTables', 0);
    const { api } = await loginAsApi('admin');
    await expect(createTable(api)).rejects.toThrow(/4\d\d/);
    await setLimit('maxTables', null);
  });
});
