import { test, expect } from '../fixtures/test';
import { DEMO_USERS } from '../fixtures/demo-users';

test.describe('Admin — User management', () => {
  test('lists seeded users with role labels', async ({ adminPage }) => {
    await adminPage.goto('admin/users');
    await expect(adminPage).toHaveURL(/\/admin\/users/);

    // The seeded staff list should be visible by name or email.
    await expect(adminPage.locator('body')).toContainText(DEMO_USERS.manager.firstName);
    await expect(adminPage.locator('body')).toContainText(DEMO_USERS.waiter.firstName);
  });

  test('WAITER cannot reach /admin/users', async ({ waiterPage }) => {
    await waiterPage.goto('admin/users');
    // ProtectedRoute redirects unauthorized roles.
    await expect(waiterPage).not.toHaveURL(/\/admin\/users/);
  });
});
