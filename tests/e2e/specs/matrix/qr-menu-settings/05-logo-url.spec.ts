import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: `logoUrl` set vs cleared.
 *
 * QRMenuLayout.tsx renders an <img> with the normalised logoUrl when
 * one is set; otherwise it falls back to a small UtensilsCrossed
 * lucide-react SVG inside a colored square. We assert on:
 *   • the <img src="..."> existence/absence
 *   • the fallback SVG existence/absence (UtensilsCrossed renders as
 *     a <svg class="lucide lucide-utensils-crossed">)
 *
 * The fallback is more brittle than the <img> assertion, so we lean
 * primarily on the <img> presence/absence — the SVG check is a
 * complementary sanity probe.
 */
test.describe('QR menu — logoUrl branding', () => {
  test('logoUrl set → <img> with that src renders in header', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { logoUrl: 'https://placehold.co/64x64.png' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('img[src*="placehold.co"]').first()).toBeVisible();

    await setQrMenuSettings(api, { logoUrl: '' });
  });

  test('logoUrl cleared → no placehold.co <img>; UtensilsCrossed fallback present', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { logoUrl: '' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('img[src*="placehold.co"]')).toHaveCount(0);

    // lucide-react renders icons as <svg class="lucide lucide-utensils-crossed">.
    // At least one such svg should exist (the header fallback).
    const fallbackCount = await page.locator('svg.lucide-utensils-crossed').count();
    expect(fallbackCount).toBeGreaterThan(0);
  });
});
