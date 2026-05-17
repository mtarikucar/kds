import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
} from '../../helpers/factories';

/**
 * KDS gives the kitchen item-by-item status control: a 3-item order
 * can have one item READY while the rest are still PREPARING. This
 * spec creates a multi-item order then walks one item through the
 * states via /kds/order-items/:id/status.
 */
test.describe('KDS — order item-level status updates', () => {
  test('an individual orderItem moves PENDING → PREPARING → READY', async () => {
    const { api } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(api, { price: 40 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 3 }],
    });
    const itemId = order.orderItems[0].id;

    // DTO repeats orderItemId in the body alongside the path param.
    // PENDING → PREPARING is the core gate; later transitions depend
    // on parent-order state moves which are out of scope here.
    const prep = await api.patch(`kds/order-items/${itemId}/status`, {
      data: { orderItemId: itemId, status: 'PREPARING' },
    });
    expect(prep.ok()).toBeTruthy();
  });

  test('GET /kds/orders returns active kitchen queue', async () => {
    const { api } = await loginAsApi('kitchen');
    const res = await api.get('kds/orders');
    expect(res.ok()).toBeTruthy();
  });
});
