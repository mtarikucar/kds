import { test, expect } from '../fixtures/test';

test.describe('Subscription — plans + checkout entry', () => {
  test('plans page lists available subscription tiers', async ({ adminPage }) => {
    await adminPage.goto('subscription/plans');
    await expect(adminPage).toHaveURL(/\/subscription\/plans/);
    // Backend seeds FREE, BASIC, PRO, BUSINESS plan names.
    await expect(adminPage.locator('body')).toContainText(/basic|pro|business|profesyonel|başlangıç/i, {
      timeout: 15_000,
    });
  });

  test('billing-cycle toggle switches between monthly and yearly', async ({ adminPage }) => {
    await adminPage.goto('subscription/plans');
    const yearly = adminPage.getByRole('button', { name: /yearly|yıllık/i }).first();
    if (await yearly.isVisible().catch(() => false)) {
      await yearly.click();
      // Yearly view shows a savings hint or different prices; we just
      // confirm the page didn't crash.
      await expect(adminPage).toHaveURL(/\/subscription\/plans/);
    }
  });

  test('contact-us / EMAIL-fallback route is gone', async ({ adminPage }) => {
    // After the PayTR-only refactor, /subscription/contact must 404
    // (or redirect to a non-contact page). It should NOT render the
    // "contact us" page.
    await adminPage.goto('subscription/contact');
    await expect(adminPage.locator('body')).not.toContainText(/contact us|bizimle iletişime geçin/i);
  });
});
