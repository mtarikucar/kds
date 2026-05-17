import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  cancelOrder,
  advanceOrderToServed,
  paySingle,
} from '../../helpers/factories';

test.describe('Tables — auto-status sync with order presence', () => {
  test('creating an order on AVAILABLE table flips it to OCCUPIED', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);

    expect(table.status).toBe('AVAILABLE');

    await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    const after = await (await api.get(`tables/${table.id}`)).json();
    expect(after.status).toBe('OCCUPIED');
  });

  test('paying the only active order on a table releases it to AVAILABLE', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 40 });
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    await advanceOrderToServed(api, order.id);
    await paySingle(api, order.id, { amount: 40 });

    const after = await (await api.get(`tables/${table.id}`)).json();
    expect(after.status).toBe('AVAILABLE');
  });

  test('cancelling the only active order also releases the table', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api);
    const table = await createTable(api);

    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    await cancelOrder(api, order.id);

    const after = await (await api.get(`tables/${table.id}`)).json();
    expect(after.status).toBe('AVAILABLE');
  });

  test('table with two active orders stays OCCUPIED until both close', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 20 });
    const table = await createTable(api);

    const a = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    const b = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    await advanceOrderToServed(api, a.id);
    await paySingle(api, a.id, { amount: 20 });

    // One order paid, the other still active — table should remain OCCUPIED.
    let snapshot = await (await api.get(`tables/${table.id}`)).json();
    expect(snapshot.status).toBe('OCCUPIED');

    await advanceOrderToServed(api, b.id);
    await paySingle(api, b.id, { amount: 20 });

    snapshot = await (await api.get(`tables/${table.id}`)).json();
    expect(snapshot.status).toBe('AVAILABLE');
  });
});
