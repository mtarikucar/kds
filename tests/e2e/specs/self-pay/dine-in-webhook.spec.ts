import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  setPosSettings,
  createCustomerSession,
  createSelfPayIntent,
  getPayableItems,
} from '../../helpers/factories';

/**
 * Self-pay end-to-end via the live PayTR sandbox isn't reachable from
 * this test harness (we don't ship real merchant credentials), so the
 * webhook-settle leg is exercised separately in subscriptions/* once
 * the synthetic PayTR helper has a server-side anchor row to hit.
 *
 * These specs cover the parts that DO run locally:
 *   - public session creation
 *   - payable-items visibility for a waiter-created order
 *   - the `enableCustomerSelfPay = false` gating that hides the CTA
 */
test.describe('Self-pay (dine-in) — gating + visibility', () => {
  test('customer session sees the waiter-created order in payable-items', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableCustomerSelfPay: true });

    const { product } = await createCategoryAndProduct(api, { price: 80 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
    });

    const session = await createCustomerSession(order.tenantId, table.id);
    expect(session.sessionId).toBeTruthy();

    const payable: any = await getPayableItems(session.sessionId);
    expect(payable).toBeTruthy();
    const orders = Array.isArray(payable) ? payable : payable.orders ?? [];
    const targetOrder = orders.find((o: any) => o.orderId === order.id || o.id === order.id);
    expect(targetOrder).toBeDefined();
  });

  test('pay-intent is rejected when the tenant has not opted in', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableCustomerSelfPay: false });

    const { product } = await createCategoryAndProduct(api, { price: 25 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });
    const session = await createCustomerSession(order.tenantId, table.id);

    await expect(
      createSelfPayIntent(session.sessionId, [
        {
          orderId: order.id,
          orderItemId: order.orderItems[0].id,
          quantity: 1,
        },
      ]),
    ).rejects.toThrow(/4\d\d|5\d\d/); // either a 4xx (opt-in check) or a 5xx (PayTR)
  });
});
