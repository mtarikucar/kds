import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
} from '../../helpers/factories';

test.describe('Tables — transfer orders between tables', () => {
  test('moves all active orders from source to target', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const source = await createTable(api);
    const target = await createTable(api);

    const order = await createOrder(api, {
      tableId: source.id,
      items: [{ productId: product.id }],
    });

    const res = await api.post('orders/transfer-table', {
      data: {
        sourceTableId: source.id,
        targetTableId: target.id,
      },
    });
    expect(res.ok()).toBeTruthy();

    // Source should drop to AVAILABLE, target should become OCCUPIED.
    const [srcAfter, tgtAfter, orderAfter] = await Promise.all([
      (await api.get(`tables/${source.id}`)).json(),
      (await api.get(`tables/${target.id}`)).json(),
      (await api.get(`orders/${order.id}`)).json(),
    ]);
    expect(srcAfter.status).toBe('AVAILABLE');
    expect(tgtAfter.status).toBe('OCCUPIED');
    expect(orderAfter.tableId).toBe(target.id);
  });

  test('rejects transfer when target table is RESERVED (without allowMerge)', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const source = await createTable(api);
    const reserved = await createTable(api, { status: 'RESERVED' });

    await createOrder(api, {
      tableId: source.id,
      items: [{ productId: product.id }],
    });

    const res = await api.post('orders/transfer-table', {
      data: {
        sourceTableId: source.id,
        targetTableId: reserved.id,
      },
    });
    expect(res.status()).toBe(400);
  });
});
