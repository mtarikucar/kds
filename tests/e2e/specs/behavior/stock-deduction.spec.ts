import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { createCategory, createProduct } from '../../helpers/factories';

/**
 * Product-level stock is MANUAL — the auto-deduct on order create
 * is reserved for the recipe/ingredient path (StockDeductionService,
 * tested separately). The `Product.currentStock` field is only
 * mutated via `PATCH /menu/products/:id/stock` and the manual
 * `deductStockForOrder` helper. These specs lock that contract.
 */
test.describe('Stock → product currentStock manual adjustment', () => {
  test('PATCH /menu/products/:id/stock decrements tracked stock', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, {
      categoryId: cat.id,
      price: 50,
      stockTracked: true,
      currentStock: 10,
    });

    const res = await api.patch(`menu/products/${product.id}/stock`, { data: { quantity: -3 } });
    expect(res.ok()).toBeTruthy();

    const after = await (await api.get(`menu/products/${product.id}`)).json();
    expect(after.currentStock).toBe(7);
  });

  test('decrementing below zero is refused', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, {
      categoryId: cat.id,
      price: 25,
      stockTracked: true,
      currentStock: 2,
    });

    const res = await api.patch(`menu/products/${product.id}/stock`, { data: { quantity: -5 } });
    expect(res.status()).toBe(400);

    const after = await (await api.get(`menu/products/${product.id}`)).json();
    expect(after.currentStock).toBe(2);
  });

  test('stockTracked=false product refuses stock adjustments', async () => {
    const { api } = await loginAsApi('admin');
    const cat = await createCategory(api);
    const product = await createProduct(api, {
      categoryId: cat.id,
      price: 25,
      stockTracked: false,
    });

    const res = await api.patch(`menu/products/${product.id}/stock`, { data: { quantity: -1 } });
    expect(res.status()).toBe(400);
  });
});
