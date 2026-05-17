import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createStockItem, getStockItem } from '../../helpers/factories';

/**
 * stock-management items (ingredients) — the inventory unit underneath
 * recipes. Each item carries a currentStock decimal, minStock alert
 * threshold and a unit-of-measure enum. CRUD here is the lowest layer;
 * recipe-driven deduction, waste logs and stock counts all mutate the
 * `currentStock` recorded here via IngredientMovement audit rows.
 */
test.describe('Stock items — CRUD + low-stock listing', () => {
  test('POST creates a stock item and GET returns it', async () => {
    const { api } = await loginAsApi('admin');
    const created = await createStockItem(api, { currentStock: 50, minStock: 10 });
    expect(created.id).toBeTruthy();

    const fetched = await getStockItem(api, created.id);
    expect(fetched.name).toBe(created.name);
    expect(Number(fetched.currentStock)).toBe(50);
    expect(Number(fetched.minStock)).toBe(10);
  });

  test('PATCH /:id updates name + minStock', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api, { currentStock: 20, minStock: 5 });
    const newName = `${item.name}-renamed`;
    const res = await api.patch(`stock-management/items/${item.id}`, {
      data: { name: newName, minStock: 8 },
    });
    expect(res.ok()).toBeTruthy();
    const after = await getStockItem(api, item.id);
    expect(after.name).toBe(newName);
    expect(Number(after.minStock)).toBe(8);
  });

  test('items at-or-below minStock surface on /low-stock', async () => {
    const { api } = await loginAsApi('admin');
    // Set currentStock <= minStock so the item lands on the low-stock
    // shelf immediately.
    const item = await createStockItem(api, { currentStock: 2, minStock: 5 });
    const res = await api.get('stock-management/items/low-stock');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const items: Array<{ id: string }> = Array.isArray(body) ? body : body.data ?? body.items ?? [];
    expect(items.some((it) => it.id === item.id)).toBeTruthy();
  });

  test('DELETE removes the item (soft or hard — both leave findOne 404)', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api);
    const del = await api.delete(`stock-management/items/${item.id}`);
    expect(del.ok()).toBeTruthy();
    const after = await api.get(`stock-management/items/${item.id}`);
    // Soft-deleted items disappear from the tenant view → 404.
    expect(after.status()).toBe(404);
  });

  test('negative minStock is refused (Min(0) on DTO)', async () => {
    const { api } = await loginAsApi('admin');
    const res = await api.post('stock-management/items', {
      data: { name: `Bad ${Date.now()}`, unit: 'KG', minStock: -1 },
    });
    expect(res.status()).toBe(400);
  });
});
