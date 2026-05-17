import { test, expect } from '../fixtures/test';

test.describe('Kitchen — KDS', () => {
  test('kitchen user reaches the KDS columns', async ({ kitchenPage }) => {
    await kitchenPage.goto('kitchen');
    await expect(kitchenPage).toHaveURL(/\/kitchen/);
    // Mobile uses tabs; desktop uses three columns. Either way the
    // status labels Pending / Preparing / Ready are on screen.
    const body = kitchenPage.locator('body');
    await expect(body).toContainText(/pending|bekleyen|hazırlanan|preparing/i, { timeout: 15_000 });
  });

  test('admin can also reach KDS', async ({ adminPage }) => {
    await adminPage.goto('kitchen');
    await expect(adminPage).toHaveURL(/\/kitchen/);
  });

  test('KDS columns render with the three lanes', async ({ kitchenPage }) => {
    await kitchenPage.goto('kitchen');
    // Verify the three status lanes are present. Counts depend on
    // demo seed timing + cron sweepers, so we don't assert on numbers
    // here — that belongs in an order-flow integration test that
    // creates its own data.
    const body = kitchenPage.locator('body');
    await expect(body).toContainText(/pending|bekleyen/i, { timeout: 15_000 });
    await expect(body).toContainText(/preparing|hazırlanan/i);
    await expect(body).toContainText(/ready|hazır/i);
  });
});
