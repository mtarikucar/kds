import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
} from '../../helpers/factories';

/**
 * End-to-end: an order created via the API surfaces on the KDS
 * screen in real time (KdsGateway emits `order:new` which the
 * frontend's useKitchenSocket() picks up). This spec opens the
 * kitchen display in a browser, then issues an API order, and
 * waits for the new order's number to appear on the page.
 *
 * Catches regressions in: socket auth, gateway emit, frontend
 * subscription, and rendering. None of those are covered by API
 * tests alone.
 */
test.describe('Realtime — order placed via API appears on KDS', () => {
  test('waiter posts order → kitchen page renders it without reload', async ({
    kitchenPage,
  }) => {
    // Kitchen user is already on the dashboard via the fixture; open the
    // KDS screen first so the socket is connected before the order fires.
    await kitchenPage.goto('kitchen');
    await expect(
      kitchenPage.getByText(/pending|bekleyen/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Build test data via the admin API to keep setup snappy.
    const { api: adminApi } = await loginAsApi('admin');
    const { product } = await createCategoryAndProduct(adminApi, { price: 35 });
    const table = await createTable(adminApi);

    // Submit the order as the waiter.
    const { api: waiterApi } = await loginAsApi('waiter');
    const order = await createOrder(waiterApi, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 2 }],
    });

    // The KDS screen renders order cards keyed by orderNumber; wait
    // for ours to appear without reloading the page.
    await expect(
      kitchenPage.getByText(order.orderNumber, { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
  });
});
