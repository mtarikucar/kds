import { test, expect } from '../fixtures/test';

test.describe('POS — waiter shell', () => {
  test('waiter lands on POS with the table grid visible', async ({ waiterPage }) => {
    await waiterPage.goto('pos');
    await expect(waiterPage).toHaveURL(/\/pos/);
    // The grid is keyed by `data-tour="table-grid"`.
    await expect(waiterPage.locator('[data-tour="table-grid"]')).toBeVisible({ timeout: 15_000 });
  });

  test('selecting an available table reveals the menu and cart panels', async ({ waiterPage }) => {
    await waiterPage.goto('pos');
    const grid = waiterPage.locator('[data-tour="table-grid"]');
    await expect(grid).toBeVisible();

    // Pick a table card whose status badge reads Available / Müsait.
    // The card is a clickable element containing both the number and
    // the status. We find by text and click.
    const availableCard = grid
      .locator('div, button, article')
      .filter({ hasText: /müsait|available/i })
      .first();
    await availableCard.click();

    // After table selection the menu panel becomes visible.
    await expect(waiterPage.locator('[data-tour="menu-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(waiterPage.locator('[data-tour="order-cart"]')).toBeVisible();
  });

  test('manager can also reach POS', async ({ managerPage }) => {
    await managerPage.goto('pos');
    await expect(managerPage).toHaveURL(/\/pos/);
  });
});
