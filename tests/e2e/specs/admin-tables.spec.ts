import { test, expect } from '../fixtures/test';

test.describe('Admin — Table management', () => {
  test('lists seeded tables and shows status counts', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await expect(adminPage).toHaveURL(/\/admin\/tables/);

    // Seed-demo creates 12 tables. We don't pin the exact number (other
    // tests may add more); we just verify the page loaded with content.
    await expect(adminPage.locator('body')).toContainText(/available|müsait|occupied|dolu/i);
  });

  test('can create a new table', async ({ adminPage }) => {
    await adminPage.goto('admin/tables');
    await adminPage.getByRole('button', { name: /add table|masa ekle/i }).first().click();

    // Modal opens — fill number and capacity.
    const uniqueNumber = `E2E${Date.now().toString().slice(-5)}`;
    await adminPage.getByLabel(/number|numara|table number|masa numarası/i).first().fill(uniqueNumber);
    await adminPage.getByLabel(/capacity|kapasite/i).first().fill('4');

    await adminPage
      .getByRole('button', { name: /^(create|save|kaydet|oluştur)$/i })
      .last()
      .click();

    await expect(adminPage.locator('body')).toContainText(uniqueNumber, { timeout: 10_000 });
  });
});
