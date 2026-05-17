import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createStockCount,
  createStockItem,
  finalizeStockCount,
  getStockItem,
  recordCountedQty,
} from '../../helpers/factories';

/**
 * Stock-count (cycle count) flow:
 *
 *   POST /stock-counts                       → IN_PROGRESS session
 *                                              with one row per item
 *   PATCH /stock-counts/:id/items/:itemId    → record actual qty
 *   POST /stock-counts/:id/finalize          → applies all deltas to
 *                                              StockItem.currentStock
 *                                              and writes
 *                                              IngredientMovement type=
 *                                              COUNT_ADJUSTMENT rows
 *
 * Finalize is the single mutation point; pre-finalize the actual
 * stock balance is untouched. Specs verify both invariants.
 */
test.describe('Stock counts — record + finalize applies deltas', () => {
  test('finalizing adjusts currentStock to the recorded counted value', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api, { currentStock: 100, minStock: 5 });
    const count = await createStockCount(api, { stockItemIds: [item.id] });
    expect(count.status).toBe('IN_PROGRESS');
    expect(count.items.length).toBe(1);

    // Record a discrepancy: ground-truth says we have 85, not 100.
    await recordCountedQty(api, count.id, count.items[0].id, 85);
    // Pre-finalize: real balance is unchanged.
    const beforeFinalize = await getStockItem(api, item.id);
    expect(Number(beforeFinalize.currentStock)).toBe(100);

    const finalized = await finalizeStockCount(api, count.id);
    expect(finalized.status).toBe('COMPLETED');

    const after = await getStockItem(api, item.id);
    expect(Number(after.currentStock)).toBe(85);
  });

  test('finalize is refused when not every row has been counted', async () => {
    const { api } = await loginAsApi('admin');
    const itemA = await createStockItem(api, { currentStock: 10 });
    const itemB = await createStockItem(api, { currentStock: 20 });
    const count = await createStockCount(api, { stockItemIds: [itemA.id, itemB.id] });

    // Count only the first row; leave the second blank.
    await recordCountedQty(api, count.id, count.items[0].id, 9);
    const res = await api.post(`stock-management/stock-counts/${count.id}/finalize`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.message)).toMatch(/not been counted|uncounted/i);
  });

  test('cancel keeps balances untouched even with recorded values', async () => {
    const { api } = await loginAsApi('admin');
    const item = await createStockItem(api, { currentStock: 40 });
    const count = await createStockCount(api, { stockItemIds: [item.id] });
    await recordCountedQty(api, count.id, count.items[0].id, 25);

    const cancel = await api.post(`stock-management/stock-counts/${count.id}/cancel`);
    expect(cancel.ok()).toBeTruthy();
    const after = await getStockItem(api, item.id);
    expect(Number(after.currentStock)).toBe(40);
  });
});
