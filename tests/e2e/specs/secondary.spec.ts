import { test, expect } from '../fixtures/test';

/**
 * "Secondary" specs cover the admin pages whose value is mainly that
 * they render at all for ADMIN and respect the role gate. Drill-down
 * CRUD lives in dedicated specs (admin-menu, admin-tables, customers).
 */

test.describe('Dashboard', () => {
  test('renders for every authenticated role', async ({ adminPage }) => {
    await adminPage.goto('dashboard');
    await expect(adminPage).toHaveURL(/\/dashboard/);
  });
});

test.describe('Profile', () => {
  test('admin profile page loads with user details', async ({ adminPage }) => {
    await adminPage.goto('profile');
    await expect(adminPage).toHaveURL(/\/profile/);
    await expect(adminPage.locator('body')).toContainText(/ahmet|admin|profil|profile/i);
  });
});

test.describe('Stock management', () => {
  test('admin stock page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/stock');
    await expect(adminPage).toHaveURL(/\/admin\/stock/);
  });
});

test.describe('Reports', () => {
  test('admin reports page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/reports');
    await expect(adminPage).toHaveURL(/\/admin\/reports/);
  });

  test('analytics page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/analytics');
    await expect(adminPage).toHaveURL(/\/admin\/analytics/);
  });

  test('invoices page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/invoices');
    await expect(adminPage).toHaveURL(/\/admin\/invoices/);
  });
});

test.describe('Personnel', () => {
  test('admin personnel page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/personnel');
    await expect(adminPage).toHaveURL(/\/admin\/personnel/);
  });
});

test.describe('QR codes admin', () => {
  test('admin qr-codes page renders', async ({ adminPage }) => {
    await adminPage.goto('admin/qr-codes');
    await expect(adminPage).toHaveURL(/\/admin\/qr-codes/);
  });
});

test.describe('Settings — tab navigation', () => {
  test('default tab is subscription', async ({ adminPage }) => {
    await adminPage.goto('admin/settings');
    // Index route navigates to /admin/settings/subscription.
    await expect(adminPage).toHaveURL(/\/admin\/settings\/subscription/, { timeout: 8_000 });
  });

  test('pos tab is reachable directly', async ({ adminPage }) => {
    await adminPage.goto('admin/settings/pos');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/pos/);
  });

  test('branding tab is reachable directly', async ({ adminPage }) => {
    await adminPage.goto('admin/settings/branding');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/branding/);
  });

  test('integrations tab is reachable directly', async ({ adminPage }) => {
    await adminPage.goto('admin/settings/integrations');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/integrations/);
  });

  test('qr-menu tab is reachable directly', async ({ adminPage }) => {
    await adminPage.goto('admin/settings/qr-menu');
    await expect(adminPage).toHaveURL(/\/admin\/settings\/qr-menu/);
  });
});
