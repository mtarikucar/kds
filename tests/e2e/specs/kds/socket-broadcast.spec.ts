import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  updateOrderStatus,
} from '../../helpers/factories';
import { connectKdsAs } from '../../helpers/sockets';

test.describe('KDS — real-time socket broadcasts', () => {
  test('staff socket receives order:new when a waiter posts an order', async () => {
    const kitchen = await connectKdsAs('kitchen');

    try {
      const adminApi = (await loginAsApi('admin')).api;
      const { product } = await createCategoryAndProduct(adminApi, { price: 35 });
      const table = await createTable(adminApi);
      const { api: waiterApi } = await loginAsApi('waiter');

      // Subscribe BEFORE issuing the action — otherwise we race the event.
      const incoming = kitchen.waitFor<{ id: string; orderNumber: string }>(
        'order:new',
        undefined,
        10_000,
      );
      const order = await createOrder(waiterApi, {
        tableId: table.id,
        items: [{ productId: product.id }],
      });

      const event = await incoming;
      expect(event.id).toBe(order.id);
    } finally {
      kitchen.disconnect();
    }
  });

  test('staff socket receives order:status-changed on status update', async () => {
    const kitchen = await connectKdsAs('kitchen');

    try {
      const { api } = await loginAsApi('admin');
      const { product } = await createCategoryAndProduct(api);
      const table = await createTable(api);
      const order = await createOrder(api, {
        tableId: table.id,
        items: [{ productId: product.id }],
      });

      const incoming = kitchen.waitFor<{ orderId: string; status: string }>(
        'order:status-changed',
        (p) => p.orderId === order.id,
        10_000,
      );
      await updateOrderStatus(api, order.id, 'PREPARING');

      const event = await incoming;
      expect(event.status).toBe('PREPARING');
    } finally {
      kitchen.disconnect();
    }
  });
});
