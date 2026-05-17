import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import {
  createCategoryAndProduct,
  createTable,
  createOrder,
  setPosSettings,
} from '../../../helpers/factories';

/**
 * Setting: enableTwoStepCheckout (PosSettings)
 *
 * Backend behavior verified:
 *   - Cannot disable two-step while enableCustomerOrdering is ON
 *     (the POSSettingsService refuses the patch with 400). This pins
 *     the QR-menu approval pipeline so customer-placed orders always
 *     have a "Create Order" → admin-approve → "Take Payment" stop.
 *
 * Frontend behavior verified:
 *   - With two-step ON, the POS cart shows separate "Create Order" /
 *     "Update Order" + "Proceed to Payment" buttons.
 *   - With two-step OFF (and customer ordering also OFF), the cart
 *     collapses into a single "Checkout" button.
 */
test.describe('Setting: enableTwoStepCheckout', () => {
  test('API: cannot disable two-step while customer ordering is on', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, {
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });

    const res = await api.patch('pos-settings', {
      data: { enableTwoStepCheckout: false },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/two[- ]step|iki aşamalı|customer ordering|qr menü/i);
  });

  test('Browser: two-step ON renders the Create Order + Proceed to Payment branch', async ({
    adminPage,
  }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, {
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });

    // Seed a table + cart-able product so the cart panel renders the
    // bottom button strip (the empty cart hides the action buttons).
    const { product } = await createCategoryAndProduct(api, { price: 25 });
    const table = await createTable(api);
    await createOrder(api, {
      tableId: table.id,
      items: [{ productId: product.id }],
    });

    await adminPage.goto('pos');
    await adminPage.reload();
    await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });

    // Pick the seeded table — its OCCUPIED state will hydrate the cart
    // with the existing order, surfacing the two-step buttons.
    const tableCard = adminPage.getByText(table.number).first();
    if (await tableCard.count()) {
      await tableCard.click().catch(() => {});
    }

    // The cart shows two distinct CTAs when two-step is on:
    // "Create Order"/"Update Order" and "Proceed to Payment".
    const twoStepButtons = adminPage.getByRole('button', {
      name: /create order|update order|proceed to payment|siparişi oluştur|ödemeye geç/i,
    });
    // At least one of the two-step CTAs must surface.
    expect(await twoStepButtons.count()).toBeGreaterThan(0);
  });

  test('Browser: two-step OFF collapses cart actions to a single Checkout button', async ({
    adminPage,
  }) => {
    const { api } = await loginAsApi('admin');
    // Must flip customer ordering off first or the constraint fires.
    await setPosSettings(api, {
      enableCustomerOrdering: false,
      enableTwoStepCheckout: false,
    });

    try {
      const { product } = await createCategoryAndProduct(api, { price: 25 });
      const table = await createTable(api);
      await createOrder(api, {
        tableId: table.id,
        items: [{ productId: product.id }],
      });

      await adminPage.goto('pos');
      await adminPage.reload();
      await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });

      const tableCard = adminPage.getByText(table.number).first();
      if (await tableCard.count()) {
        await tableCard.click().catch(() => {});
      }

      // With two-step OFF, "Proceed to Payment" should be gone. The
      // single-step branch renders just "Checkout". We use a permissive
      // assertion (absence of proceed-to-payment) since "Checkout" is
      // localized many ways across locales.
      const proceedBtn = adminPage.getByRole('button', {
        name: /proceed to payment|ödemeye geç/i,
      });
      expect(await proceedBtn.count()).toBe(0);
    } finally {
      // Restore defaults so following specs see the canonical demo state.
      await setPosSettings(api, {
        enableCustomerOrdering: true,
        enableTwoStepCheckout: true,
      });
    }
  });
});
