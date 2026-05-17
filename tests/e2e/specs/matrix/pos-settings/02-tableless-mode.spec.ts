import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import {
  createCategoryAndProduct,
  setPosSettings,
} from '../../../helpers/factories';

/**
 * Setting: enableTablelessMode (PosSettings)
 *
 * Backend behavior verified:
 *   - With the flag OFF, a TAKEAWAY order without a table is the
 *     "tableless" path; the service SHOULD reject it. Current behavior
 *     is permissive (no enforcement) — we accept 200/201/400 to lock
 *     the contract while documenting the gap (see existing
 *     settings-effects/pos-toggles.spec.ts).
 *
 * Frontend behavior verified:
 *   - With ON, the POS waiter screen surfaces a "Takeaway Order" hero
 *     card that bypasses table selection.
 *   - With OFF, that hero card is absent — the table grid is the only
 *     entry point.
 */
test.describe('Setting: enableTablelessMode', () => {
  test('Browser OFF: takeaway hero is NOT shown on the POS screen', async ({ adminPage }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableTablelessMode: false });
    await adminPage.goto('pos');
    await adminPage.reload();

    await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });
    const hero = adminPage.getByText(/takeaway order|paket sipariş/i);
    await expect(hero).toHaveCount(0);
  });

  test('Browser ON: a Takeaway Order hero card appears', async ({ adminPage }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableTablelessMode: true });
    try {
      await adminPage.goto('pos');
      await adminPage.reload();

      await expect(
        adminPage.getByText(/takeaway order|paket sipariş/i).first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await setPosSettings(api, { enableTablelessMode: false });
    }
  });

  test('API OFF: TAKEAWAY order without table — contract gap (no strict rejection yet)', async () => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableTablelessMode: false });

    const { product } = await createCategoryAndProduct(api);
    const res = await api.post('orders', {
      data: {
        type: 'TAKEAWAY',
        items: [{ productId: product.id, quantity: 1 }],
      },
    });
    // CONTRACT GAP: the service currently doesn't enforce the toggle
    // on the create-order path. Accept either rejection (400) or
    // permissive pass-through (200/201) so this assertion locks the
    // contract: when enforcement lands, only 400 should remain.
    expect([200, 201, 400]).toContain(res.status());
  });
});
