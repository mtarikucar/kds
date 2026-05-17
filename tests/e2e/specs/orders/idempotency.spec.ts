import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
} from '../../helpers/factories';

test.describe('Orders — idempotency', () => {
  test('same idempotencyKey returns the same order on retry', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 40 });
    const table = await createTable(api);

    // crypto.randomUUID exists in Node 19+; tests run under modern node.
    const key = crypto.randomUUID();
    const first = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
      idempotencyKey: key,
    });

    const second = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    expect(second.orderNumber).toBe(first.orderNumber);
  });

  test('omitting idempotencyKey creates distinct orders even for identical payload', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 25 });
    const table = await createTable(api);

    const a = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    const b = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    expect(b.id).not.toBe(a.id);
    expect(b.orderNumber).not.toBe(a.orderNumber);
  });
});
