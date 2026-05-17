import { Page, expect } from '@playwright/test';

/**
 * Click a sidebar nav item by its visible label. Falls back to the
 * href-based locator when the label match is ambiguous (e.g. a status
 * banner mentions "POS" in passing). The sidebar's items are
 * accessible-role links rendered by NavLink.
 */
export async function gotoFromSidebar(page: Page, hrefSuffix: string): Promise<void> {
  // Sidebar may be off-screen on mobile widths; open it first if needed.
  const hamburger = page.getByRole('button', { name: /open menu|menü|menu/i });
  if (await hamburger.isVisible().catch(() => false)) {
    await hamburger.click();
  }
  await page.locator(`a[href$="${hrefSuffix}"]`).first().click();
  await page.waitForURL(new RegExp(`${escapeRe(hrefSuffix)}(\\?|$)`));
}

/** Direct-navigate and assert no redirect to /login (would mean ProtectedRoute kicked us out). */
export async function gotoAuthenticated(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 5_000 });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
