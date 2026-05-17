import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: `showDescription` true vs false.
 *
 * ProductCard renders the description `<p>` only when
 * `showDescription && product.description` (see ProductCard.tsx line 130).
 * The Sultanahmet demo seed (seed-demo.ts) has well-known product
 * descriptions we can match on — we pick a short, distinctive one
 * ("Demlik cay" for the "Cay" product) so the assertion is unambiguous.
 */
const KNOWN_DESCRIPTION = /Demlik cay/i; // from seed-demo.ts Icecekler/Cay

test.describe('QR menu — showDescription toggle', () => {
  test('showDescription=false → known product descriptions absent', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showDescription: false });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    // Ensure cards are populated before we assert absence.
    await expect(page.getByText(/cay|kebap|baklava/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const descMatches = await page.getByText(KNOWN_DESCRIPTION).count();
    expect(descMatches).toBe(0);

    await setQrMenuSettings(api, { showDescription: true });
  });

  test('showDescription=true → at least one known description renders', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { showDescription: true });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(KNOWN_DESCRIPTION).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
