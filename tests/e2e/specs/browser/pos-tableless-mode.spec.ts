import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { setPosSettings } from '../../helpers/factories';

/**
 * enableTablelessMode is the POS waiter-side flag. With it OFF
 * the table-selection screen is the only entry — every order
 * goes through a table. With it ON the page surfaces an extra
 * "Takeaway Order" hero card that bypasses table selection.
 *
 * This spec asserts the UI actually changes between the two
 * states — not just that the API echo'd the new value.
 */
test.describe('POS — tableless mode UI', () => {
  test('OFF: takeaway hero is NOT shown on the POS screen', async ({ adminPage }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableTablelessMode: false });
    await adminPage.goto('pos');
    await adminPage.reload();

    // Make sure POS rendered before asserting on absence.
    await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });
    const hero = adminPage.getByText(/takeaway order|paket sipariş/i);
    await expect(hero).toHaveCount(0);
  });

  test('ON: a Takeaway Order hero card appears alongside the table grid', async ({ adminPage }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, { enableTablelessMode: true });
    await adminPage.goto('pos');
    await adminPage.reload();

    // The takeaway card surfaces a localized "Takeaway Order /
    // Paket Sipariş" string. The element is an h2 nested inside a
    // <button>, so we match by text rather than by role+level
    // (the heading-role check sometimes misses nested buttons).
    await expect(
      adminPage.getByText(/takeaway order|paket sipariş/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Restore default so following specs see the standard flow.
    await setPosSettings(api, { enableTablelessMode: false });
  });
});
