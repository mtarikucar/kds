import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: `itemsPerRow` 2 vs 3 vs 4 (with layoutStyle=GRID).
 *
 * QRMenuContent.tsx maps the value to a Tailwind grid class:
 *   • itemsPerRow === 1 → 'grid grid-cols-1 gap-4'
 *   • itemsPerRow === 3 → 'grid grid-cols-2 sm:grid-cols-3 gap-4'
 *   • else (2, 4, ...)  → 'grid grid-cols-2 gap-4'
 * So the frontend only distinguishes 1 / 3 / "everything else". We
 * assert exactly that — and explicitly note that `4` collapses to the
 * 2-column grid in the current implementation. The test still locks
 * the round-trip and the DOM consequence.
 */
test.describe('QR menu — itemsPerRow matrix', () => {
  test('itemsPerRow=2 (GRID) → container has grid-cols-2 class', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { layoutStyle: 'GRID', itemsPerRow: 2 });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const cols2 = await page.locator('div.grid.grid-cols-2').count();
    expect(cols2).toBeGreaterThan(0);

    // Should not be the 3-column variant.
    const cols3 = await page.locator('div.grid.grid-cols-2.sm\\:grid-cols-3').count();
    expect(cols3).toBe(0);
  });

  test('itemsPerRow=3 (GRID) → container has sm:grid-cols-3 class', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { layoutStyle: 'GRID', itemsPerRow: 3 });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const cols3 = await page.locator('div.grid.grid-cols-2.sm\\:grid-cols-3').count();
    expect(cols3).toBeGreaterThan(0);

    await setQrMenuSettings(api, { itemsPerRow: 2 });
  });

  test('itemsPerRow=4 (GRID) → falls back to grid-cols-2 in current impl', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { layoutStyle: 'GRID', itemsPerRow: 4 });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Frontend code path: only `=== 1` and `=== 3` get special grids;
    // every other value (including 4) collapses to grid-cols-2.
    const cols2 = await page.locator('div.grid.grid-cols-2').count();
    expect(cols2).toBeGreaterThan(0);
    const cols3 = await page.locator('div.grid.grid-cols-2.sm\\:grid-cols-3').count();
    expect(cols3).toBe(0);

    await setQrMenuSettings(api, { itemsPerRow: 2 });
  });
});
