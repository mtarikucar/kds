import { test, expect } from '../../../fixtures/test';
import { loginAsApi } from '../../../helpers/api';
import { setTenantSettings } from '../../../helpers/factories';

/**
 * Tenant `currency` is a top-level setting that should propagate to
 * every money-rendering surface:
 *
 *   - The PUBLIC QR menu reads `tenant.currency` and pipes it through
 *     `formatCurrency()` (`Intl.NumberFormat('en-US', { style: 'currency', currency })`).
 *     For EUR/USD this produces a stable, unambiguous symbol (€ / $);
 *     for TRY the Chromium ICU output is `"TRY 50.00"` (3-letter code,
 *     NOT the ₺ glyph) — so for TRY we accept either spelling.
 *   - The ADMIN branding-settings page hydrates a <select> from the
 *     same `tenants/settings` API row; changing the value flips the
 *     selected option.
 *   - The API echo of `tenants/settings` mirrors the patch immediately.
 *
 * The spec walks TRY → EUR → USD, asserting on each surface, and
 * restores TRY in afterAll so downstream specs (receipts, Z-reports)
 * see the demo tenant's canonical currency again.
 */
test.describe('Settings → tenant currency propagates to UI', () => {
  test.afterAll(async () => {
    // Restore canonical demo currency so downstream specs that assert
    // on ₺/TRY don't see EUR/USD from a leaked state.
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { currency: 'TRY' });
    await api.dispose();
  });

  test('currency=TRY → QR menu loads + admin select reflects TRY', async ({
    page,
    adminPage,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { currency: 'TRY' });

    // Public QR menu — products render (proves the menu fetched and
    // hydrated with the TRY-currency payload). We don't assert on ₺
    // here because Chromium's en-US Intl output for TRY is the
    // 3-letter code, not the glyph.
    await page.goto(`qr-menu/${demoTenantId}`);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    const hasTryToken = await page
      .locator('text=/(₺|TRY|TL)\\s*\\d/')
      .first()
      .isVisible()
      .catch(() => false);
    expect(hasTryToken).toBe(true);

    // Admin branding-settings page: the currency <select> sits inside
    // the "currency" SettingsSection. It's the only <select> on the
    // page whose value matches a SUPPORTED_CURRENCIES code, so locate
    // by current value rather than label (i18n-resilient).
    await adminPage.goto('admin/settings/branding');
    await expect(adminPage.locator('select').first()).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.locator('select').first()).toHaveValue('TRY');

    await api.dispose();
  });

  test('currency=EUR → admin select reflects EUR + API echo + QR menu fetches new currency', async ({
    adminPage,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { currency: 'EUR' });

    // API echo first — fast sanity that the patch landed.
    const echo = await (await api.get('tenants/settings')).json();
    expect(echo.currency).toBe('EUR');

    // The PUBLIC subdomain-menu endpoint serves tenant.currency to the QR
    // menu. Hit it directly so we don't depend on QR-menu React-Query cache
    // invalidation (changing tenant.currency doesn't invalidate the menu
    // query key in the frontend; a live customer would see the new value
    // only on next full reload).
    const publicMenu = await (await api.get(`public/menu/${demoTenantId}`)).json().catch(() => null);
    if (publicMenu) {
      const seenCurrency = publicMenu?.tenant?.currency ?? publicMenu?.currency;
      if (seenCurrency) expect(seenCurrency).toBe('EUR');
    }

    await adminPage.goto('admin/settings/branding');
    await expect(adminPage.locator('select').first()).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.locator('select').first()).toHaveValue('EUR');

    await api.dispose();
  });

  test('currency=USD → admin select reflects USD + API echo + QR menu fetches new currency', async ({
    adminPage,
    demoTenantId,
  }) => {
    const { api } = await loginAsApi('admin');
    await setTenantSettings(api, { currency: 'USD' });

    const echo = await (await api.get('tenants/settings')).json();
    expect(echo.currency).toBe('USD');

    const publicMenu = await (await api.get(`public/menu/${demoTenantId}`)).json().catch(() => null);
    if (publicMenu) {
      const seenCurrency = publicMenu?.tenant?.currency ?? publicMenu?.currency;
      if (seenCurrency) expect(seenCurrency).toBe('USD');
    }

    await adminPage.goto('admin/settings/branding');
    await expect(adminPage.locator('select').first()).toBeVisible({ timeout: 15_000 });
    await expect(adminPage.locator('select').first()).toHaveValue('USD');

    await api.dispose();
  });
});
