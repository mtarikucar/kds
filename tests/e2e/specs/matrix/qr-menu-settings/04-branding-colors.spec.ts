import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setQrMenuSettings } from '../../../helpers/factories';

/**
 * Matrix: branding colors (primary, secondary, background).
 *
 * The QR menu applies colors via inline `style={{...}}` attributes
 * (see QRMenuLayout.tsx, ProductCard.tsx) so we can detect them by
 * walking the DOM and inspecting `element.style.<prop>`. Browsers
 * normalise `#FF0033` → `rgb(255, 0, 51)`, so we compare against the
 * normalised form. Same pattern as the reference spec:
 *   tests/e2e/specs/browser/qr-menu-rendering.spec.ts:60-67.
 *
 * Always reset to seed defaults at the end so downstream specs aren't
 * affected.
 */

const DEFAULTS = {
  primaryColor: '#3B82F6',
  secondaryColor: '#F3F4F6',
  backgroundColor: '#FFFFFF',
} as const;

async function someElementHasInlineStyle(
  page: import('@playwright/test').Page,
  styleProp: 'backgroundColor' | 'color',
  rgbValue: string,
): Promise<boolean> {
  return page.evaluate(
    ({ styleProp, rgbValue }) => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>('*'));
      return nodes.some((el) => (el.style as any)[styleProp] === rgbValue);
    },
    { styleProp, rgbValue },
  );
}

test.describe('QR menu — branding colors', () => {
  test('primaryColor #FF0033 is applied as inline backgroundColor somewhere', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { primaryColor: '#FF0033' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const found = await someElementHasInlineStyle(page, 'backgroundColor', 'rgb(255, 0, 51)');
    expect(found).toBe(true);

    await setQrMenuSettings(api, { primaryColor: DEFAULTS.primaryColor });
  });

  test('secondaryColor #00FF66 is applied as inline style somewhere', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { secondaryColor: '#00FF66' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/adana|baklava|kebap|kunefe/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // secondaryColor is used as:
    //   • product card title `color` (ProductCard.tsx line 125)
    //   • category title `color` (QRMenuContent.tsx line 326)
    //   • floating Call Waiter FAB `backgroundColor` (QRMenuLayout.tsx)
    // So check both inline-style buckets.
    const asBg = await someElementHasInlineStyle(page, 'backgroundColor', 'rgb(0, 255, 102)');
    const asFg = await someElementHasInlineStyle(page, 'color', 'rgb(0, 255, 102)');
    expect(asBg || asFg).toBe(true);

    await setQrMenuSettings(api, { secondaryColor: DEFAULTS.secondaryColor });
  });

  test('backgroundColor #1A1A2E is applied to the page root', async ({
    page,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setQrMenuSettings(api, { backgroundColor: '#1A1A2E' });

    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // QRMenuLayout sets `style={{ backgroundColor: settings.backgroundColor }}`
    // on the outer wrapper.
    const found = await someElementHasInlineStyle(page, 'backgroundColor', 'rgb(26, 26, 46)');
    expect(found).toBe(true);

    await setQrMenuSettings(api, { backgroundColor: DEFAULTS.backgroundColor });
  });
});
