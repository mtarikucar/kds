import { Page, expect } from '@playwright/test';
import { DEMO_USERS, DemoRole } from '../fixtures/demo-users';

/**
 * Drive the UI login form for `role` and wait for the dashboard to
 * load. Used by the shared `loggedInAs*` fixtures and by the auth
 * spec itself (where logging-in IS the system under test).
 */
export async function loginViaUI(page: Page, role: DemoRole): Promise<void> {
  const { email, password } = DEMO_USERS[role];
  await page.goto('login');
  // The form's labels come through react-hook-form's <Input label=...>
  // wrapper which exposes them as accessible names — getByLabel is
  // the most resilient locator across translation changes.
  const emailInput = page.getByPlaceholder('you@example.com');
  const passwordInput = page.getByPlaceholder('••••••••');
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /giriş|login|sign in/i }).click();
  // After successful login the app navigates to /dashboard.
  await page.waitForURL(/\/dashboard(\b|$)/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

/**
 * Same as loginViaUI but assumes the form is already on screen
 * (saves the explicit goto when chained from a redirect).
 */
export async function fillLoginForm(page: Page, role: DemoRole): Promise<void> {
  const { email, password } = DEMO_USERS[role];
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /giriş|login|sign in/i }).click();
}

export async function logoutViaUI(page: Page): Promise<void> {
  // Header has both desktop (with label) and mobile (icon-only) logout
  // buttons; both share aria-label / accessible name "Logout" /
  // "Çıkış". Click whichever is currently rendered.
  await page
    .getByRole('button', { name: /çıkış|logout|sign out/i })
    .first()
    .click();
  await page.waitForURL(/\/login(\b|$)/, { timeout: 10_000 });
}
