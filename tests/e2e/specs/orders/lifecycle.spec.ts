import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  updateOrderStatus,
  advanceOrderToServed,
  paySingle,
} from '../../helpers/factories';

test.describe('Orders — full PENDING → PAID lifecycle', () => {
  test('walks the happy path with correct status transitions', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 100 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      type: 'DINE_IN',
      tableId: table.id,
      items: [{ productId: product.id, quantity: 2 }],
    });
    expect(order.status).toBe('PENDING');
    expect(Number(order.finalAmount)).toBe(200);

    const preparing = await updateOrderStatus(api, order.id, 'PREPARING');
    expect(preparing.status).toBe('PREPARING');

    const ready = await updateOrderStatus(api, order.id, 'READY');
    expect(ready.status).toBe('READY');

    const served = await updateOrderStatus(api, order.id, 'SERVED');
    expect(served.status).toBe('SERVED');

    const payment = await paySingle(api, order.id, { amount: 200, method: 'CASH' });
    expect(payment.status).toMatch(/COMPLETED|SUCCEEDED/);

    // Order should now be PAID. Read it back to confirm.
    const final = await api.get(`orders/${order.id}`);
    expect(final.ok()).toBeTruthy();
    const body = await final.json();
    expect(body.status).toBe('PAID');
  });

  test('rejects illegal transition (PENDING → READY skips PREPARING)', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    // PENDING → READY is not allowed by the state-machine validator
    // (must pass through PREPARING). The service throws BadRequest.
    const res = await api.patch(`orders/${order.id}/status`, { data: { status: 'READY' } });
    expect(res.status()).toBe(400);
  });

  test('terminal status (PAID) is immutable', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 50 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await advanceOrderToServed(api, order.id);
    await paySingle(api, order.id, { amount: 50 });

    // Try to push back to PREPARING — must fail.
    const res = await api.patch(`orders/${order.id}/status`, {
      data: { status: 'PREPARING' },
    });
    expect(res.status()).toBe(400);
  });

  test('discount greater than the order total is rejected with 400', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 30 });
    const table = await createTable(api);

    // Backend refuses to create the order rather than silently capping
    // — surfacing the operator's mistake instead of producing a free
    // meal. Message format:
    //   "Discount (9999) cannot exceed order total (30)."
    const res = await api.post('orders', {
      data: {
        type: 'DINE_IN',
        tableId: table.id,
        items: [{ productId: product.id, quantity: 1 }],
        discount: 9999,
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/discount.*exceed|cannot exceed/i);
  });

  test('discount equal to subtotal is accepted (order is free)', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 25 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
      discount: 25,
    });
    expect(Number(order.finalAmount)).toBe(0);
  });
});
