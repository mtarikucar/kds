import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  advanceOrderToServed,
  payByItems,
} from '../../helpers/factories';

test.describe('Payments — progressive (pay-by-items)', () => {
  test('two diners settle their share in sequence', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 50 });
    const table = await createTable(api);

    // Two items of qty=1; each diner pays one.
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 2 }],
    });
    await advanceOrderToServed(api, order.id);

    const itemId = order.orderItems[0].id;

    // First diner pays 1 unit.
    const first = await payByItems(api, order.id, {
      items: [{ orderItemId: itemId, quantity: 1 }],
      method: 'CASH',
    });
    expect(Number(first.payment.amount)).toBe(50);
    expect(first.orderFullyPaid).toBe(false);

    // Order should still be unsettled — half paid.
    let fresh = await (await api.get(`orders/${order.id}`)).json();
    expect(fresh.status).not.toBe('PAID');

    // Second diner pays the remaining 1 unit.
    const second = await payByItems(api, order.id, {
      items: [{ orderItemId: itemId, quantity: 1 }],
      method: 'CARD',
    });
    expect(Number(second.payment.amount)).toBe(50);
    expect(second.orderFullyPaid).toBe(true);

    fresh = await (await api.get(`orders/${order.id}`)).json();
    expect(fresh.status).toBe('PAID');
  });

  test('attempting to pay more units than remain is rejected', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 30 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    await advanceOrderToServed(api, order.id);

    const res = await api.post(`orders/${order.id}/payments/items`, {
      data: {
        items: [{ orderItemId: order.orderItems[0].id, quantity: 2 }],
        method: 'CASH',
      },
    });
    expect(res.status()).toBe(400);
  });
});
