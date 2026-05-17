import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { setQrMenuSettings, setTenantSettings } from '../../helpers/factories';

/**
 * Branding: when a logoUrl is set the QR menu renders an <img>
 * with that src; when it's cleared a UtensilsCrossed icon
 * (fallback) appears in its place. Both cases are visible in the
 * header tile.
 */
test.describe('QR menu — branding (logo + tenant name)', () => {
  test('logoUrl present → <img> shown; absent → fallback icon shown', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');

    // Set a known good image URL.
    await setQrMenuSettings(api, {
      logoUrl: 'https://placehold.co/64x64.png',
    });
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1', { hasText: /sultanahmet/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('img[src*="placehold.co"]').first()).toBeVisible();

    // Clear the logo and reload — fallback icon block (the
    // colored square next to the restaurant name) takes over.
    await setQrMenuSettings(api, { logoUrl: '' });
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1', { hasText: /sultanahmet/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('img[src*="placehold.co"]')).toHaveCount(0);
  });

  test('tenant name is rendered as the QR menu header', async ({ page, demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { name: 'Sultanahmet Sofra' });
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1', { hasText: /sultanahmet sofra/i }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
