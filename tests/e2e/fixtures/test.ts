import { test as base, Page } from '@playwright/test';
import { loginViaUI } from '../helpers/auth';
import { loginAsApi } from '../helpers/api';

type RoleFixtures = {
  adminPage: Page;
  managerPage: Page;
  waiterPage: Page;
  kitchenPage: Page;
  /** Sultanahmet demo tenant id, resolved once via API login. */
  demoTenantId: string;
};

/**
 * Per-test logged-in pages. Each fixture gets its own browser context
 * so they don't share cookies — important when a single test exercises
 * two roles (e.g. waiter places order, kitchen sees it).
 */
export const test = base.extend<RoleFixtures>({
  adminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaUI(page, 'admin');
    await use(page);
    await ctx.close();
  },
  managerPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaUI(page, 'manager');
    await use(page);
    await ctx.close();
  },
  waiterPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaUI(page, 'waiter');
    await use(page);
    await ctx.close();
  },
  kitchenPage: async ({ browser }, use) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginViaUI(page, 'kitchen');
    await use(page);
    await ctx.close();
  },
  demoTenantId: async ({}, use) => {
    const { user, api } = await loginAsApi('admin');
    await use(user.tenantId);
    await api.dispose();
  },
});

export { expect } from '@playwright/test';
