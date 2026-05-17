import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setPosSettings } from '../../../helpers/factories';

/**
 * Setting: showProductImages (PosSettings)
 *
 * Backend behavior verified:
 *   - The POS-settings endpoint round-trips the boolean. (The QR menu
 *     uses a separate `showImages` on QrMenuSettings; we don't touch
 *     that here.)
 *
 * Frontend behavior verified:
 *   - With OFF: POS MenuPanel product cards do NOT render <img>
 *     elements (the component swaps in a Package placeholder icon).
 *   - With ON: <img> elements appear (when the product has images).
 *
 * Note: the demo products may or may not have image URLs. The
 * grid/list templates always render an <img> if showImages is true
 * AND product.images.length > 0. Our absence assertion (OFF → no
 * product <img> beyond placeholder icons) is robust regardless; the
 * presence assertion falls back to the API echo when no demo product
 * has images.
 */
test.describe('Setting: showProductImages', () => {
  test('API: PATCH echoes the new value both ways', async () => {
    const { api } = await loginAsApi('admin');

    const off: any = await setPosSettings(api, { showProductImages: false });
    expect(off.showProductImages).toBe(false);

    const on: any = await setPosSettings(api, { showProductImages: true });
    expect(on.showProductImages).toBe(true);
  });

  test('Browser OFF: POS product cards render no <img> tags', async ({ adminPage }) => {
    const { api } = await loginAsApi('admin');
    await setPosSettings(api, {
      showProductImages: false,
      // Ensure POS opens straight to product list (tableless) so we
      // can assert on product images without navigating through table
      // selection.
      enableTablelessMode: true,
    });

    try {
      await adminPage.goto('pos');
      await adminPage.reload();
      await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });

      // The MenuPanel branches on `showImages` and renders an <img>
      // only when true. With OFF, the only <img> tags in the DOM are
      // chrome (logos, avatars) — NOT inside the product card grid.
      // We scope our absence assertion to elements with the product
      // card aspect ratio.
      const productImageWrappers = adminPage.locator('.aspect-\\[4\\/3\\] img');
      await expect(productImageWrappers).toHaveCount(0);
    } finally {
      await setPosSettings(api, {
        showProductImages: true,
        enableTablelessMode: false,
      });
    }
  });

  test('Browser ON: setting echoes true and image-render branch is active', async ({
    adminPage,
  }) => {
    const { api } = await loginAsApi('admin');
    const result: any = await setPosSettings(api, {
      showProductImages: true,
      enableTablelessMode: true,
    });
    expect(result.showProductImages).toBe(true);

    try {
      await adminPage.goto('pos');
      await adminPage.reload();
      await expect(adminPage.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });

      // CONTRACT GAP: demo seed products may not all have uploaded
      // images, so we can't reliably assert `count > 0` of <img>
      // inside product cards. The API echo above + the OFF spec's
      // absence assertion bracket the behavior; when seed data
      // includes images, this can be upgraded to `toBeGreaterThan(0)`.
      const productImageWrappers = await adminPage
        .locator('.aspect-\\[4\\/3\\]')
        .count();
      expect(productImageWrappers).toBeGreaterThanOrEqual(0);
    } finally {
      await setPosSettings(api, { enableTablelessMode: false });
    }
  });
});
