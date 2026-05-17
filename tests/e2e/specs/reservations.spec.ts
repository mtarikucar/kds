import { test, expect } from '../fixtures/test';

test.describe('Reservations — public booking + admin view', () => {
  test('public reservation page loads for demo tenant', async ({ page, demoTenantId }) => {
    await page.goto(`reserve/${demoTenantId}`);
    await expect(page).toHaveURL(new RegExp(`/reserve/${demoTenantId}`));
    // Form has date, time, party-size fields; restaurant name appears.
    await expect(page.locator('body')).toContainText(/sultanahmet|reservation|rezervasyon/i, {
      timeout: 15_000,
    });
  });

  test('reservation lookup page is reachable', async ({ page, demoTenantId }) => {
    await page.goto(`reserve/${demoTenantId}/lookup`);
    await expect(page).toHaveURL(/lookup/);
  });

  test('admin reservations page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/reservations');
    await expect(adminPage).toHaveURL(/\/admin\/reservations/);
  });
});
