import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createStockItem, getStockItem, recordWaste } from '../../helpers/factories';

/**
 * Waste logs decrement the underlying StockItem.currentStock and write
 * an IngredientMovement row with type=WASTE. Tests verify the
 * before/after balance moves by the recorded quantity.
 */
test.describe('Waste logs — decrement currentStock', () => {
  test('POST waste-log records the loss and reduces the item balance', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api, { currentStock: 50, minStock: 5 });

    await recordWaste(api, { stockItemId: item.id, quantity: 7, reason: 'EXPIRED' });

    const after = await getStockItem(api, item.id);
    expect(Number(after.currentStock)).toBe(43);
  });

  test('waste reason must be a valid enum value', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api, { currentStock: 10 });
    const res = await api.post('stock-management/waste-logs', {
      data: { stockItemId: item.id, quantity: 1, reason: 'NONSENSE' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /summary returns aggregate values without crashing', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api, { currentStock: 30 });
    await recordWaste(api, { stockItemId: item.id, quantity: 2, reason: 'DAMAGED' });

    const res = await api.get('stock-management/waste-logs/summary');
    expect(res.ok()).toBeTruthy();
  });
});
