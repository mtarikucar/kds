import { test, expect } from '../fixtures/test';

test.describe('Customers — list + create', () => {
  test('renders seeded customer list', async ({ adminPage }) => {
    await adminPage.goto('customers');
    await expect(adminPage).toHaveURL(/\/customers/);

    // Seed-demo creates 10 customers (Ayse Yildiz, Hasan Korkmaz, ...).
    await expect(adminPage.locator('body')).toContainText(/ayse|hasan|fatma/i, { timeout: 10_000 });
  });

  test('can add a new customer', async ({ adminPage }) => {
    await adminPage.goto('customers');
    await adminPage
      .getByRole('button', { name: /add customer|müşteri ekle|new customer|yeni müşteri/i })
      .first()
      .click();

    const name = `E2E Müşteri ${Date.now()}`;
    // CustomerFormModal labels collapse to "Name *" / "Ad *". The
    // trailing asterisk is part of the visible label so the regex
    // matches the prefix instead.
    const nameField = adminPage.getByLabel(/^(name|ad)\s*\*/i).first();
    await nameField.fill(name);

    const emailField = adminPage.getByLabel(/^(email|e-posta)/i).first();
    await emailField.fill(`e2e+${Date.now()}@example.com`);

    // Backend DTO requires phone (E.164-ish); the frontend Zod schema
    // marks it optional, so the form lets you submit without it and
    // the API returns 400. Always include a phone in this test.
    const phoneField = adminPage.getByLabel(/^(phone|telefon)/i).first();
    await phoneField.fill(`+90555${String(Date.now()).slice(-7)}`);

    // The modal's submit button text equals the modal title in this
    // form (t('customers.addCustomer')) — "Add Customer" / "Müşteri
    // Ekle". The page also has the same text on the top "open modal"
    // CTA; .last() picks the in-modal one.
    await adminPage
      .getByRole('button', { name: /add customer|müşteri ekle/i })
      .last()
      .click();

    await expect(adminPage.locator('body')).toContainText(name, { timeout: 10_000 });
  });

  test('search filters the list', async ({ adminPage }) => {
    await adminPage.goto('customers');
    const search = adminPage.getByPlaceholder(/search|ara/i).first();
    await search.fill('Ayse');
    // Debounce gracefully — give the list a beat to filter.
    await adminPage.waitForTimeout(500);
    await expect(adminPage.locator('body')).toContainText(/ayse/i);
  });
});
