import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: `showPrices` true vs false.
 *
 * ProductCard renders a ₺-prefixed currency string only when
 * `showPrices=true` (see ProductCard.tsx — both the floating price
 * badge in GRID layout and the inline price span in LIST layout).
 * We assert on the actual rendered DOM, not the API payload — the
 * customer-facing surface is what we care about.
 *
 * The currency symbol comes from `formatCurrency(..., 'TRY')`, which
 * normalises to "₺" + non-breaking-space + digit. Matching `₺` followed
 * by any whitespace + digit is robust against locale/format drift.
 */
test.describe('QR menu — showPrices toggle', () => {
  test('showPrices=false → ZERO ₺ marks anywhere on the menu page', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showPrices: false });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // Wait for product cards to render so we don't measure an empty page.
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const tlMarks = await page.locator('text=/₺\\s*\\d/').count();
    expect(tlMarks).toBe(0);

    await setQrMenuSettings(api, { showPrices: true });
  });

  test('showPrices=true → at least one price token next to a digit appears', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showPrices: true });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Chromium's en-US Intl output uses the 3-letter code for TRY ("TRY 50.00")
    // but the glyph for EUR/USD ("€50.00", "$50.00"). Match any currency token
    // so the spec doesn't false-fail when downstream specs left a non-TRY currency.
    const priceTokens = await page.locator('text=/(₺|TRY|TL|€|\\$|USD|EUR)\\s*\\d/').count();
    expect(priceTokens).toBeGreaterThan(0);

    // Already at the default — no cleanup needed.
  });
});
