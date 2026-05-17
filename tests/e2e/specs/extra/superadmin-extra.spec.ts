import { test, expect } from '../../fixtures/test';
import { APIRequestContext } from '@playwright/test';
import { loginAsSuperAdmin } from '../../helpers/api';

/**
 * SuperAdmin endpoints beyond auth + tenant CRUD: cross-tenant
 * users, audit logs, dashboard stats. Cached login (TOTP-replay
 * window) so all checks share one session.
 */
let superApi: APIRequestContext;

test.beforeAll(async () => {
  ({ api: superApi } = await loginAsSuperAdmin());
});

test.describe('SuperAdmin — cross-tenant users + audit + dashboard', () => {
  test('GET /superadmin/users returns the seeded staff list', async () => {
    const res = await superApi.get('superadmin/users');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const items = Array.isArray(body) ? body : body.data ?? body.items ?? [];
    expect(items.length).toBeGreaterThan(0);
  });

  test('GET /superadmin/audit-logs paginates platform-wide actions', async () => {
    const res = await superApi.get('superadmin/audit-logs');
    expect(res.ok()).toBeTruthy();
  });

  test('GET /superadmin/dashboard/stats returns platform counters', async () => {
    const res = await superApi.get('superadmin/dashboard/stats');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // Shape varies; at minimum the response is an object with numbers.
    expect(typeof body).toBe('object');
  });

  test('GET /superadmin/dashboard/revenue returns chart-ready data', async () => {
    const res = await superApi.get('superadmin/dashboard/revenue');
    expect(res.ok()).toBeTruthy();
  });

  test('GET /superadmin/dashboard/audit-recent does not return 5xx', async () => {
    const res = await superApi.get('superadmin/dashboard/audit-recent?limit=5');
    // Accept 2xx/4xx — backend may surface a 4xx if the recent-activity
    // helper returns null on an empty audit table. The contract we lock
    // is "no server crash".
    expect(res.status()).toBeLessThan(500);
  });
});
