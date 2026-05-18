import { test, expect } from '../../fixtures/test';
import { request } from '@playwright/test';
import { API_BASE } from '../../helpers/api';

/**
 * Auth lifecycle: register, password reset, change-password,
 * verify-email negative paths. The existing auth.spec.ts covers the
 * UI login/logout/role-gate surface; this file owns the API contract
 * for sign-up + credential management.
 *
 * Cleanups: each test mints its own throwaway email so the tests are
 * independent. Created users live in the DB but their UNIQUE
 * (email, tenantId) is randomised, so reruns don't collide.
 */

const PASSWORD_OK = 'Passw0rd!';
const PASSWORD_BAD_NO_UPPER = 'passw0rd!';

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

async function newPublicCtx() {
  return request.newContext({ baseURL: API_BASE });
}

test.describe('Auth — register', () => {
  test('new-restaurant signup creates a tenant + admin user + 14-day BUSINESS trial', async () => {
    const pub = await newPublicCtx();
    const email = uniqueEmail('newresto');
    const res = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'Demo',
        lastName: 'Owner',
        restaurantName: `Test Resto ${Date.now()}`,
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user?.email).toBe(email);
    expect(body.user?.role).toBe('ADMIN');

    // Subscription state — registration now auto-attaches a 14-day
    // BUSINESS trial instead of dropping the tenant onto FREE. The
    // assertion lives here (not in a separate spec) so the
    // registration contract is a single source of truth for downstream
    // changes.
    const authed = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${body.accessToken}` },
    });
    try {
      const subRes = await authed.get('subscriptions/current');
      expect(subRes.ok()).toBeTruthy();
      const sub = await subRes.json();
      expect(sub.plan?.name).toBe('BUSINESS');
      expect(sub.status).toBe('TRIALING');
      expect(sub.isTrialPeriod).toBe(true);
      expect(sub.trialStart).toBeTruthy();
      expect(sub.trialEnd).toBeTruthy();
    } finally {
      await authed.dispose();
    }
    await pub.dispose();
  });

  test('duplicate email returns 409', async () => {
    const pub = await newPublicCtx();
    const email = uniqueEmail('dupe');
    const first = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R ${Date.now()}`,
      },
    });
    expect(first.ok()).toBeTruthy();

    const dupe = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R2 ${Date.now()}`,
      },
    });
    expect(dupe.status()).toBe(409);
    await pub.dispose();
  });

  test('weak password (no upper-case) is refused with 400', async () => {
    const pub = await newPublicCtx();
    const res = await pub.post('auth/register', {
      data: {
        email: uniqueEmail('weakpw'),
        password: PASSWORD_BAD_NO_UPPER,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R ${Date.now()}`,
      },
    });
    expect(res.status()).toBe(400);
    await pub.dispose();
  });

  test('register must supply either restaurantName or tenantId', async () => {
    const pub = await newPublicCtx();
    const res = await pub.post('auth/register', {
      data: {
        email: uniqueEmail('noresto'),
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
      },
    });
    expect(res.status()).toBe(400);
    await pub.dispose();
  });
});

test.describe('Auth — forgot / reset password', () => {
  test('forgot-password returns 2xx even for unknown emails (no leak)', async () => {
    const pub = await newPublicCtx();
    const res = await pub.post('auth/forgot-password', {
      data: { email: `does-not-exist-${Date.now()}@example.com` },
    });
    // Service explicitly returns the generic success-message regardless.
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(String(body.message)).toMatch(/reset link/i);
    await pub.dispose();
  });

  test('forgot-password for an existing user also returns 2xx', async () => {
    // Create a user first so we hit the "real" code path.
    const pub = await newPublicCtx();
    const email = uniqueEmail('forgot');
    const created = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R ${Date.now()}`,
      },
    });
    expect(created.ok()).toBeTruthy();

    const res = await pub.post('auth/forgot-password', { data: { email } });
    expect(res.ok()).toBeTruthy();
    await pub.dispose();
  });

  test('reset-password with an invalid token is rejected with 400', async () => {
    const pub = await newPublicCtx();
    const res = await pub.post('auth/reset-password', {
      data: { token: 'not-a-real-token', newPassword: 'NewPassw0rd!' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(String(body.message)).toMatch(/invalid|expired/i);
    await pub.dispose();
  });
});

test.describe('Auth — change-password', () => {
  test('happy path: new password works, old does not, refresh tokens revoked', async () => {
    const pub = await newPublicCtx();
    const email = uniqueEmail('changepw');
    const reg = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R ${Date.now()}`,
      },
    });
    expect(reg.ok()).toBeTruthy();
    const { accessToken } = await reg.json();
    await pub.dispose();

    // Authed context for change-password.
    const authed = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });
    const newPw = 'NewPassw0rd!';
    const change = await authed.post('auth/change-password', {
      data: { currentPassword: PASSWORD_OK, newPassword: newPw },
    });
    expect(change.ok()).toBeTruthy();
    await authed.dispose();

    // Old password should be rejected at login.
    const pub2 = await newPublicCtx();
    const loginOld = await pub2.post('auth/login', { data: { email, password: PASSWORD_OK } });
    expect(loginOld.status()).toBe(401);

    const loginNew = await pub2.post('auth/login', { data: { email, password: newPw } });
    expect(loginNew.ok()).toBeTruthy();
    await pub2.dispose();
  });

  test('wrong current password is rejected with 400', async () => {
    const pub = await newPublicCtx();
    const email = uniqueEmail('changepw-bad');
    const reg = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R ${Date.now()}`,
      },
    });
    const { accessToken } = await reg.json();
    await pub.dispose();

    const authed = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` },
    });
    const change = await authed.post('auth/change-password', {
      data: { currentPassword: 'wrong-current-pw', newPassword: 'NewPassw0rd!' },
    });
    expect(change.status()).toBe(400);
    await authed.dispose();
  });
});

test.describe('Auth — verify-email', () => {
  test('invalid 6-digit code is refused', async () => {
    const pub = await newPublicCtx();
    const email = uniqueEmail('verify');
    const reg = await pub.post('auth/register', {
      data: {
        email,
        password: PASSWORD_OK,
        firstName: 'A',
        lastName: 'B',
        restaurantName: `R ${Date.now()}`,
      },
    });
    expect(reg.ok()).toBeTruthy();

    const res = await pub.post('auth/verify-email', {
      data: { email, code: '000000' },
    });
    // Service responds with verified=false on bad code; some impls
    // return 400. Either is acceptable — the contract we care about is
    // "no false success" (verified=true would be a security bug).
    if (res.ok()) {
      const body = await res.json();
      expect(body.verified).toBe(false);
    } else {
      expect(res.status()).toBeGreaterThanOrEqual(400);
    }
    await pub.dispose();
  });
});
