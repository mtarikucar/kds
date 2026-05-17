import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import { setQrMenuSettings } from '../../helpers/factories';

/**
 * QR-menu settings are server-rendered into the per-tenant menu
 * payload; the React app reads them and conditionally renders
 * product cards. These specs flip the setting via API, then OPEN
 * THE PUBLIC QR-MENU IN A BROWSER and verify the rendered DOM
 * actually changes — not just the API echo.
 */
test.describe('QR menu rendering reflects settings (browser)', () => {
  test('showImages=false hides product card image containers', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');

    // ProductCard renders the image wrapper conditionally:
    //   {showImages && <div className="... aspect-[4/3]">...</div>}
    // The ProgressiveImage inside uses an intersection observer so
    // the inner <img> only mounts when scrolled into view — we
    // assert on the WRAPPER (always in DOM) instead, which is the
    // direct signal of `showImages`.
    await setQrMenuSettings(api, { showImages: false });
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.getByText(/adana|baklava|kebap/i).first()).toBeVisible({
      timeout: 15_000,
    });
    const containers = await page.locator('.aspect-\\[4\\/3\\]').count();
    expect(containers).toBe(0);

    // Restore for downstream specs.
    await setQrMenuSettings(api, { showImages: true });
  });

  test('showPrices=false hides product prices from the menu surface', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showPrices: false });
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // ₺ symbols only appear next to prices.
    const tlMarks = await page.locator('text=/₺\\s*\\d/').count();
    expect(tlMarks).toBe(0);

    await setQrMenuSettings(api, { showPrices: true });
  });

  test('primaryColor change is applied to action buttons', async ({ page, demoTenantId }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { primaryColor: '#FF0033' });
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // The QR menu uses inline `style={{ backgroundColor: settings.primaryColor }}`
    // on action buttons; the browser normalises #FF0033 → rgb(255, 0, 51).
    const colored = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('*'));
      return nodes.some((el) => (el.style.backgroundColor || '') === 'rgb(255, 0, 51)');
    });
    expect(colored).toBe(true);

    await setQrMenuSettings(api, { primaryColor: '#3B82F6' });
  });
});
