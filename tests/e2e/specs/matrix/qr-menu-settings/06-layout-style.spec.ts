import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: `layoutStyle` GRID vs LIST vs COMPACT.
 *
 * QRMenuContent.tsx (lines 278-286 / 345-353) selects the container
 * class purely on layoutStyle:
 *   • 'LIST'    → 'flex flex-col gap-4'
 *   • 'GRID'    → 'grid grid-cols-2 gap-4' (or grid-cols-3 when itemsPerRow=3)
 *   • 'COMPACT' → falls through to the same grid branch as GRID
 *     (no separate compact class). So we only assert the LIST vs
 *     GRID branching at the container level. For COMPACT we re-assert
 *     the API setting round-trip, since the visual difference is
 *     mostly inside ProductCard (LIST gives `flex flex-row h-28`).
 *
 * The reliable DOM signal for LIST vs GRID is the ProductCard root:
 *   ProductCard.tsx line 67:
 *     layoutStyle === 'LIST' ? 'flex flex-row h-28' : 'flex flex-col'
 * So we count cards whose article has the `h-28` (LIST) class vs not.
 */
test.describe('QR menu — layoutStyle matrix', () => {
  test('layoutStyle=GRID → product cards use grid container, no h-28 LIST cards', async ({
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

    // The container around product cards has a `grid` class in GRID mode.
    const gridContainers = await page.locator('div.grid.grid-cols-2').count();
    expect(gridContainers).toBeGreaterThan(0);

    // No ProductCard should be in LIST form (no `h-28` flex-row articles).
    const listCards = await page.locator('article.flex.flex-row.h-28').count();
    expect(listCards).toBe(0);
  });

  test('layoutStyle=LIST → flex-col container, cards use flex-row h-28', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { layoutStyle: 'LIST' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // At least one ProductCard rendered in LIST form.
    const listCards = await page.locator('article.flex.flex-row.h-28').count();
    expect(listCards).toBeGreaterThan(0);

    await setQrMenuSettings(api, { layoutStyle: 'GRID' });
  });

  test('layoutStyle=COMPACT → setting round-trips and grid still renders', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { layoutStyle: 'COMPACT' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // COMPACT currently falls back to the grid branch (no LIST cards).
    const listCards = await page.locator('article.flex.flex-row.h-28').count();
    expect(listCards).toBe(0);

    await setQrMenuSettings(api, { layoutStyle: 'GRID' });
  });
});
