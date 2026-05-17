import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCustomer,
  createCategoryAndProduct,
  createTable,
  createOrder,
  advanceOrderToServed,
} from '../../helpers/factories';

test.describe('Loyalty — earning on order payment', () => {
  test('customer linked via phone on payment accrues points', async () => {
    const { api } = await loginAsApi('admin');
    const customer = await createCustomer(api);

    const { product } = await createCategoryAndProduct(api, { price: 100 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    await advanceOrderToServed(api, order.id);

    const before = await (await api.get(`customers/${customer.id}`)).json();
    const beforePoints = before.loyaltyPoints ?? 0;

    // Pass customerPhone on the payment — that's the link point the
    // loyalty service uses to credit a known customer (vs. anonymous).
    const res = await api.post(`orders/${order.id}/payments`, {
      data: {
        amount: 100,
        method: 'CASH',
        customerPhone: customer.phone,
      },
    });
    expect(res.ok()).toBeTruthy();

    const after = await (await api.get(`customers/${customer.id}`)).json();
    expect(after.loyaltyPoints).toBeGreaterThan(beforePoints);
  });

  test('paying the same order twice does not double-credit points', async () => {
    // earnPointsFromOrder is idempotent on (customerId, orderId) — a
    // payment retry (e.g. tablet network blip) must not inflate the
    // customer's balance.
    const { api } = await loginAsApi('admin');
    const customer = await createCustomer(api);

    const { product } = await createCategoryAndProduct(api, { price: 50 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    await advanceOrderToServed(api, order.id);

    const idempotencyKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await api.post(`orders/${order.id}/payments`, {
      data: {
        amount: 50,
        method: 'CASH',
        customerPhone: customer.phone,
        idempotencyKey,
      },
    });
    const afterFirst = await (await api.get(`customers/${customer.id}`)).json();

    // Replay with same idempotencyKey → idempotency path returns the
    // existing payment row; no second loyalty credit.
    await api.post(`orders/${order.id}/payments`, {
      data: {
        amount: 50,
        method: 'CASH',
        customerPhone: customer.phone,
        idempotencyKey,
      },
    });
    const afterReplay = await (await api.get(`customers/${customer.id}`)).json();

    expect(afterReplay.loyaltyPoints).toBe(afterFirst.loyaltyPoints);
  });
});
