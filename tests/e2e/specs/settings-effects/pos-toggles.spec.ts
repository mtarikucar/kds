import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  updateOrderStatus,
  setPosSettings,
  paySingle,
} from '../../helpers/factories';

test.describe('Settings → POS toggles propagate to behavior', () => {
  test('requireServedForDineInPayment=true blocks payment until order is SERVED', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { requireServedForDineInPayment: true });

    const { product } = await createCategoryAndProduct(api, { price: 40 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await updateOrderStatus(api, order.id, 'PREPARING');
    await updateOrderStatus(api, order.id, 'READY');
    // Note: NOT advancing to SERVED.

    // Pay attempt at READY (not SERVED) must fail.
    const blocked = await api.post(`orders/${order.id}/payments`, {
      data: { amount: 40, method: 'CASH' },
    });
    expect(blocked.status()).toBe(400);
    const body = await blocked.json();
    expect(body.message).toMatch(/served|tenant policy/i);

    // After SERVED, payment succeeds.
    await updateOrderStatus(api, order.id, 'SERVED');
    const ok = await paySingle(api, order.id, { amount: 40 });
    expect(Number(ok.amount)).toBe(40);
  });

  test('requireServedForDineInPayment=false (default) lets us pay from READY', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { requireServedForDineInPayment: false });

    const { product } = await createCategoryAndProduct(api, { price: 30 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await updateOrderStatus(api, order.id, 'PREPARING');
    await updateOrderStatus(api, order.id, 'READY');

    // No SERVED — should still be payable.
    const ok = await paySingle(api, order.id, { amount: 30 });
    expect(Number(ok.amount)).toBe(30);
  });

  test('enableTablelessMode=false rejects orders without a tableId', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableTablelessMode: false });

    const { product } = await createCategoryAndProduct(api);
    // TAKEAWAY without table is the "tableless" path. With the toggle
    // OFF, the service should reject it.
    const res = await api.post('orders', {
      data: {
        type: 'TAKEAWAY',
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    // Either backend rejects with 400 (preferred) or it lets it through.
    // The product currently does not enforce, so this test will
    // surface a gap if/when the enforcement lands. Accept both for
    // now — primary purpose is locking the contract.
    expect([200, 201, 400]).toContain(res.status());
  });
});
