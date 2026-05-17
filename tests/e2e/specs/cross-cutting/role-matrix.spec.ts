import { test, expect } from '../../fixtures/test';
import { loginAsApi } from '../../helpers/api';
import type { DemoRole } from '../../fixtures/demo-users';

/**
 * Role × route matrix. ProtectedRoute on the frontend bounces clients
 * to /dashboard when role is wrong; backend enforces via `@Roles(...)`
 * and the RolesGuard. This test locks the backend half — drift here
 * is a 401 vs 403 inconsistency or a missing `@Roles` decorator.
 */
type AllowMap = { GET?: DemoRole[]; POST?: DemoRole[]; PATCH?: DemoRole[] };

const ROUTE_MATRIX: Array<{ path: string; method: keyof AllowMap; allowed: DemoRole[] }> = [
  { path: 'tables', method: 'POST', allowed: ['admin', 'manager'] },
  { path: 'menu/categories', method: 'POST', allowed: ['admin', 'manager'] },
  { path: 'menu/products', method: 'POST', allowed: ['admin', 'manager'] },
  { path: 'reports/sales', method: 'GET', allowed: ['admin', 'manager'] },
  { path: 'orders', method: 'POST', allowed: ['admin', 'manager', 'waiter'] },
  { path: 'z-reports', method: 'POST', allowed: ['admin', 'manager'] },
];

test.describe('Cross-cutting — role × route grid', () => {
  for (const entry of ROUTE_MATRIX) {
    for (const role of ['admin', 'manager', 'waiter', 'kitchen'] as DemoRole[]) {
      const expectAllow = entry.allowed.includes(role);
      const label = `${role} ${expectAllow ? 'CAN' : 'CANNOT'} ${entry.method} /${entry.path}`;
      test(label, async () => {
        const { api } = await loginAsApi(role);
        // For mutating methods we send a deliberately invalid body so
        // the request fails fast on validation (400) when the user
        // IS allowed, vs 403 when they aren't. Both signal correctly.
        const res =
          entry.method === 'GET'
            ? await api.get(entry.path)
            : entry.method === 'POST'
              ? await api.post(entry.path, { data: { __probe: true } })
              : await api.patch(entry.path, { data: {} });

        if (expectAllow) {
          // Allowed: anything except 401/403. A 400 (validation) is fine.
          expect([401, 403]).not.toContain(res.status());
        } else {
          // Forbidden: must be 401 or 403, never reach business logic.
          expect([401, 403]).toContain(res.status());
        }
      });
    }
  }
});
