import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  updateOrderStatus,
  cancelOrder,
} from '../../helpers/factories';

test.describe('Orders — cancellation', () => {
  test('cancel from PENDING releases the table', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    // Table should be OCCUPIED while order is active.
    const occupied = await (await api.get(`tables/${table.id}`)).json();
    expect(occupied.status).toBe('OCCUPIED');

    await cancelOrder(api, order.id);

    // After cancellation the orders-service syncs table status; no
    // other active orders → AVAILABLE.
    const after = await (await api.get(`tables/${table.id}`)).json();
    expect(after.status).toBe('AVAILABLE');
  });

  test('cancel from PREPARING is allowed', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await updateOrderStatus(api, order.id, 'PREPARING');

    await cancelOrder(api, order.id);

    const fresh = await (await api.get(`orders/${order.id}`)).json();
    expect(fresh.status).toBe('CANCELLED');
  });

  test('PAID → CANCELLED is allowed as the void / refund path', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 30 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await updateOrderStatus(api, order.id, 'PREPARING');
    await updateOrderStatus(api, order.id, 'READY');
    await updateOrderStatus(api, order.id, 'SERVED');
    await api.post(`orders/${order.id}/payments`, {
      data: { amount: 30, method: 'CASH' },
    });

    // The state machine intentionally permits PAID → CANCELLED so
    // ops can void / refund a completed order. The transition itself
    // does not auto-reverse Payment rows — that's a separate refund
    // flow (covered in payments/refund.spec.ts).
    const res = await api.patch(`orders/${order.id}/status`, {
      data: { status: 'CANCELLED' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('CANCELLED');
  });

  test('CANCELLED is terminal — no further transitions', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await cancelOrder(api, order.id);

    // CANCELLED → anything must fail.
    const res = await api.patch(`orders/${order.id}/status`, {
      data: { status: 'PENDING' },
    });
    expect(res.status()).toBe(400);
  });
});
