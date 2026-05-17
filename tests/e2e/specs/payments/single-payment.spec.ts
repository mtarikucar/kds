import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  advanceOrderToServed,
  paySingle,
} from '../../helpers/factories';

test.describe('Payments — single payment for whole order', () => {
  test('CASH payment matching final amount marks order PAID', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 75 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 2 }],
    });
    await advanceOrderToServed(api, order.id);

    const payment = await paySingle(api, order.id, { amount: 150, method: 'CASH' });
    expect(Number(payment.amount)).toBe(150);

    const fresh = await (await api.get(`orders/${order.id}`)).json();
    expect(fresh.status).toBe('PAID');
  });

  test('same idempotencyKey returns the same payment row', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 40 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await advanceOrderToServed(api, order.id);

    const key = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const a = await paySingle(api, order.id, { amount: 40, idempotencyKey: key });
    const b = await paySingle(api, order.id, { amount: 40, idempotencyKey: key });
    expect(b.id).toBe(a.id);
  });

  test('overpayment beyond remaining balance is rejected', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 20 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await advanceOrderToServed(api, order.id);

    const res = await api.post(`orders/${order.id}/payments`, {
      data: { amount: 9999, method: 'CASH' },
    });
    expect(res.status()).toBe(400);
  });
});
