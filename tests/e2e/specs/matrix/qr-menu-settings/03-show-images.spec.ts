import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: `showImages` true vs false.
 *
 * Asserts on the WRAPPER div `.aspect-[4/3]` instead of the inner <img>
 * because ProgressiveImage uses an IntersectionObserver — the actual
 * <img> only mounts when scrolled into view. The wrapper, however, is
 * always present in DOM when `showImages=true` (and only when), so it's
 * the cleanest signal. See ProductCard.tsx lines 73-77.
 */
test.describe('QR menu — showImages toggle', () => {
  test('showImages=false → ZERO image wrappers in DOM', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showImages: false });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const wrappers = await page.locator('.aspect-\\[4\\/3\\]').count();
    expect(wrappers).toBe(0);

    await setQrMenuSettings(api, { showImages: true });
  });

  test('showImages=true → at least one image wrapper in DOM', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showImages: true });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const wrappers = await page.locator('.aspect-\\[4\\/3\\]').count();
    expect(wrappers).toBeGreaterThan(0);
  });
});
