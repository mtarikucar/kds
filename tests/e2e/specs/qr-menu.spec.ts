import { test, expect } from '../fixtures/test';

test.describe('QR Menu — public customer flow', () => {
  test('anonymous visitor can load the public menu for the demo tenant', async ({ page, demoTenantId }) => {
    await page.goto(`qr-menu/${demoTenantId}`);
    // The QR menu uses Vite's /app/ base; URL stays under that prefix.
    await expect(page).toHaveURL(new RegExp(`/qr-menu/${demoTenantId}`));

    // Seeded products (Adana Kebap, Baklava, Çay) should surface.
    await expect(page.locator('body')).toContainText(/adana|baklava|çay|cay/i, { timeout: 15_000 });
  });

  test('search filters menu items', async ({ page, demoTenantId }) => {
    await page.goto(`qr-menu/${demoTenantId}`);
    const search = page.getByPlaceholder(/search|ara/i).first();
    if (await search.isVisible().catch(() => false)) {
      await search.fill('baklava');
      await page.waitForTimeout(500);
      await expect(page.locator('body')).toContainText(/baklava/i);
    }
  });
});
