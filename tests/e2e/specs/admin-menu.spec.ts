import { test, expect } from '../fixtures/test';

test.describe('Admin — Menu management', () => {
  test('renders categories and product cards from seed data', async ({ adminPage }) => {
    await adminPage.goto('admin/menu');
    await expect(adminPage.getByRole('heading', { name: /menu|menü/i }).first()).toBeVisible();
    // Sultanahmet demo seeds 8 categories; at least the headline "Izgara" is reliable.
    await expect(adminPage.locator('body')).toContainText(/izgara|tatlilar|içecekler/i);
  });

  test('can create a new category', async ({ adminPage }) => {
    await adminPage.goto('admin/menu');
    await adminPage.getByRole('button', { name: /add category|kategori ekle/i }).first().click();

    // Modal opens with a Name input. The form is rendered inside a
    // <Modal> portal — be specific so we don't grab the search input
    // from the page background.
    const nameInput = adminPage.getByLabel(/category name|kategori adı/i);
    const unique = `E2E Kategori ${Date.now()}`;
    await nameInput.fill(unique);

    // The modal's save button text is t('app.save') / t('app.create').
    await adminPage
      .getByRole('button', { name: /^(save|kaydet|create|oluştur)$/i })
      .last()
      .click();

    await expect(adminPage.locator('body')).toContainText(unique, { timeout: 10_000 });
  });
});
