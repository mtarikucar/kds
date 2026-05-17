import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import {
  createCustomer,
  createCategoryAndProduct,
  createTable,
  createOrder,
  advanceOrderToServed,
} from '../../helpers/factories';

/**
 * LOYALTY_CONFIG tiers: BRONZE 0+, SILVER 500+, GOLD 2000+, PLATINUM 5000+.
 * After enough cumulative points are earned, the loyaltyTier field on
 * the customer row promotes deterministically. We earn enough to push
 * through one boundary and assert the tier moves up.
 */
test.describe('Loyalty → tier promotion on cumulative earn', () => {
  test('paying enough to cross the SILVER threshold promotes the customer', async () => {
    const { api } = await loginAsApi('admin');
    const customer = await createCustomer(api);

    // Default earn rate is 1 point / currency unit; SILVER threshold
    // is 500 cumulative. A single 600-TRY order pushes us past.
    const { product } = await createCategoryAndProduct(api, { price: 600 });
    const table = await createTable(api);
    const order = await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id, quantity: 1 }],
    });
    await advanceOrderToServed(api, order.id);
    await api.post(`orders/${order.id}/payments`, {
      data: {
        amount: 600,
        method: 'CASH',
        customerPhone: customer.phone,
      },
    });

    const after = await (await api.get(`customers/${customer.id}`)).json();
    expect(after.loyaltyPoints).toBeGreaterThanOrEqual(500);
    // Tier may be SILVER or higher depending on multiplier; just
    // confirm we moved off BRONZE.
    expect(after.loyaltyTier).not.toBe('BRONZE');
  });
});
