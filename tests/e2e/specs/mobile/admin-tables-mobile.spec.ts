import { test, expect } from '../../fixtures/test';

/**
 * Mobile (Pixel 5, 393×851) regression for /admin/tables.
 *
 * The page header used to be `flex flex-shrink-0` — on mobile the
 * fixed-width icon + title kept the row at desktop width and pushed
 * the "Yeni Masa / Add Table" button off-screen and unclickable.
 * After the fix (TableManagementPage.tsx switched to
 * `flex flex-wrap … gap-3 md:gap-4`) the button drops to a second
 * row instead, still visible and tappable on every supported phone.
 *
 * Runs under the `mobile-chromium` Playwright project (see
 * playwright.config.ts `projects[1]`); the desktop project ignores
 * specs/mobile/** so these don't double-bill.
 */
test.describe('Mobile (Pixel 5) — /admin/tables', () => {
  test('add-table button is visible and clickable on a phone viewport', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await expect(adminPage).toHaveURL(/\/admin\/tables/);

    // Header should render. We wait on the page title so the assertion
    // below isn't racing the initial render.
    await expect(adminPage.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    const addButton = adminPage
      .getByRole('button', { name: /add table|masa ekle/i })
      .first();

    await expect(addButton).toBeVisible({ timeout: 10_000 });
    // toBeInViewport guards against the regression that the original
    // bug exhibited — the button rendered in DOM but the parent flex
    // pushed it outside the viewport, so `.click()` would scroll-then-
    // click and pass a "visible" assertion while a real user couldn't
    // reach it. `toBeInViewport({ ratio: 0.5 })` insists half the
    // button is on-screen without any scroll.
    await expect(addButton).toBeInViewport({ ratio: 0.5 });
  });

  test('header does not overflow horizontally on a phone viewport', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await expect(adminPage.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    // A page that overflows horizontally is a classic mobile
    // regression — the user can scroll sideways and content disappears
    // off the edge. We compare documentElement scrollWidth to its
    // clientWidth: equal (within a 1px rounding tolerance) means no
    // horizontal overflow.
    const overflow = await adminPage.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth - el.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('full happy path: tap → modal → submit → new row appears', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await expect(adminPage.locator('h1').first()).toBeVisible({ timeout: 15_000 });

    await adminPage
      .getByRole('button', { name: /add table|masa ekle/i })
      .first()
      .click();

    const uniqueNumber = `M${Date.now().toString().slice(-5)}`;
    await adminPage
      .getByLabel(/number|numara|table number|masa numarası/i)
      .first()
      .fill(uniqueNumber);
    await adminPage.getByLabel(/capacity|kapasite/i).first().fill('2');

    await adminPage
      .getByRole('button', { name: /^(create|save|kaydet|oluştur)$/i })
      .last()
      .click();

    await expect(adminPage.locator('body')).toContainText(uniqueNumber, { timeout: 10_000 });
  });
});
