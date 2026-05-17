import { test, expect } from '../fixtures/test';
import { loginViaUI, logoutViaUI } from '../helpers/auth';
import { DEMO_USERS } from '../fixtures/demo-users';

test.describe('Auth — login / logout', () => {
  test('admin can log in and reach the dashboard', async ({ page }) => {
    await loginViaUI(page, 'admin');
    await expect(page).toHaveURL(/\/dashboard/);
    // The user's first name appears in the header profile link on
    // screens ≥md; on smaller widths it's hidden, so we look for the
    // app shell instead.
    await expect(page.locator('header')).toContainText(/HummyTummy/i);
  });

  test('rejects wrong credentials with a 401 and stays on /login', async ({ page }) => {
    await page.goto('login');
    await page.getByPlaceholder('you@example.com').fill(DEMO_USERS.admin.email);
    await page.getByPlaceholder('••••••••').fill('definitely-wrong');

    // Observe the auth POST directly — toast assertions are flaky
    // because sonner auto-dismisses within a few seconds.
    const [loginResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/auth/login') && res.request().method() === 'POST',
        { timeout: 10_000 },
      ),
      page.getByRole('button', { name: /giriş|login|sign in/i }).click(),
    ]);
    expect(loginResponse.status()).toBe(401);
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout clears session and redirects to /login', async ({ page }) => {
    await loginViaUI(page, 'admin');
    await logoutViaUI(page);
    // Direct-nav to a protected page should bounce back to login.
    await page.goto('dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('protected route bounces to /login when not authenticated', async ({ page }) => {
    await page.goto('dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  });
});

test.describe('Auth — role gates', () => {
  test('WAITER cannot reach /admin/users (redirects away)', async ({ waiterPage }) => {
    await waiterPage.goto('admin/users');
    // ProtectedRoute redirects unauthorized roles to /dashboard, not 403.
    await expect(waiterPage).toHaveURL(/\/dashboard|\/pos/, { timeout: 8_000 });
  });

  test('KITCHEN cannot reach /pos (redirects away)', async ({ kitchenPage }) => {
    await kitchenPage.goto('pos');
    await expect(kitchenPage).toHaveURL(/\/dashboard|\/kitchen/, { timeout: 8_000 });
  });

  test('KITCHEN can reach /kitchen', async ({ kitchenPage }) => {
    await kitchenPage.goto('kitchen');
    await expect(kitchenPage).toHaveURL(/\/kitchen/);
  });

  test('ADMIN can reach /admin/menu', async ({ adminPage }) => {
    await adminPage.goto('admin/menu');
    await expect(adminPage).toHaveURL(/\/admin\/menu/);
  });
});

test.describe('Auth — session refresh', () => {
  test('reload on a protected route keeps the user signed in', async ({ adminPage }) => {
    await adminPage.goto('dashboard');
    await adminPage.reload();
    // ProtectedRoute fires POST /auth/refresh on mount when there's
    // a persisted user but no in-memory access token. We should NOT
    // land on /login.
    await expect(adminPage).not.toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(adminPage).toHaveURL(/\/dashboard/);
  });
});
