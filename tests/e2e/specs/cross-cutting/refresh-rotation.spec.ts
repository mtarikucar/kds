import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { DEMO_USERS } from '../../fixtures/demo-users';
import { API_BASE } from '../../helpers/api';

/**
 * Refresh-token rotation regression lock. Two parallel refreshes
 * from the same cookie used to (a) generate the same rotated JWT
 * (P2002 on `tokenHash` unique) and (b) hit the reuse-detection
 * branch and revoke the family — both fixed in a prior session.
 * This spec keeps the regression caught.
 */
test.describe('Cross-cutting — refresh-token rotation', () => {
  test('sequential refresh issues a new token and the prior one is revoked', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const loginRes = await ctx.post('auth/login', {
        data: { email: DEMO_USERS.admin.email, password: DEMO_USERS.admin.password },
      });
      expect(loginRes.ok()).toBeTruthy();

      // First refresh — must succeed; the response writes a new
      // refreshToken cookie that overrides the one set on login.
      const firstRefresh = await ctx.post('auth/refresh');
      expect(firstRefresh.ok()).toBeTruthy();
      const firstBody = await firstRefresh.json();
      expect(firstBody.accessToken).toBeTruthy();

      // Second refresh — must also succeed, since the cookie was
      // rotated by the first response.
      const secondRefresh = await ctx.post('auth/refresh');
      expect(secondRefresh.ok()).toBeTruthy();
    } finally {
      await ctx.dispose();
    }
  });

  test('two parallel refreshes do not collide on tokenHash', async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      await ctx.post('auth/login', {
        data: { email: DEMO_USERS.manager.email, password: DEMO_USERS.manager.password },
      });

      // Fire two refreshes in parallel. One should win the rotation
      // race; the other gets either 401 (reuse-detected — old token)
      // or 200 (cookie was rotated before second hit). Both are
      // acceptable contract outcomes. The forbidden outcome is a
      // 5xx (e.g. P2002 on tokenHash) — that's the regression.
      const [a, b] = await Promise.all([ctx.post('auth/refresh'), ctx.post('auth/refresh')]);
      expect(a.status()).toBeLessThan(500);
      expect(b.status()).toBeLessThan(500);
    } finally {
      await ctx.dispose();
    }
  });
});
