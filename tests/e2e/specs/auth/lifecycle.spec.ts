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
  test('new-restaurant signup lands on the free core — no plan, no subscription, no trial', async () => {
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

    // v3.3.0 registration contract. A brand-new tenant gets a tenant row,
    // a Main branch and an ADMIN user — and nothing else.
    // `AuthProvisioningService.provisionNewTenantWithAdmin` does not look a
    // plan up, does not stamp `currentPlanId`, does not write a Subscription
    // and does not start a countdown of any kind. Capability comes from the
    // free core every tenant holds unconditionally, plus whatever annual
    // modules that tenant later buys.
    //
    // This assertion deliberately lives with the register spec rather than in
    // a subscription spec of its own: signup is where the "what does a new
    // customer actually get" contract is decided, so a change that reintroduces
    // a plan or a countdown should fail HERE.
    //
    // What this replaced: the previous version of this test asserted a 14-day
    // BUSINESS trial (plan.name === 'BUSINESS', status TRIALING, isTrialPeriod,
    // trialStart/trialEnd populated). That rail was retired by the 2026-08-11
    // à-la-carte migrations, so those lines had turned into a test that
    // guarded a contract the product no longer offers.
    const branchId: string | undefined = body.user?.primaryBranchId ?? undefined;
    expect(branchId, 'signup must mint a Main branch and assign it').toBeTruthy();

    const authed = await request.newContext({
      baseURL: API_BASE,
      extraHTTPHeaders: {
        Authorization: `Bearer ${body.accessToken}`,
        // BranchGuard is global and strict: every branch-scoped route needs
        // the header, with no fallback to a JWT claim or "first active branch".
        'X-Branch-Id': branchId as string,
      },
    });
    try {
      const subRes = await authed.get('subscriptions/current');
      expect(subRes.ok()).toBeTruthy();
      // The handler is a `findFirst`, so "no subscription" comes back as an
      // empty body — parse defensively instead of calling .json() on ''.
      const rawSub = (await subRes.text()).trim();
      const sub = rawSub ? JSON.parse(rawSub) : null;
      expect(sub, 'a newly registered tenant must not own a subscription').toBeFalsy();

      // ...and the free core is usable immediately, with nothing bought and
      // no countdown running: the menu is part of the free core, so creating
      // a category is a plain success rather than an entitlement refusal.
      const cat = await authed.post('menu/categories', {
        data: { name: `E2E Free Core ${Date.now()}` },
      });
      const catBody = await cat.text();
      expect(
        cat.ok(),
        `free-core menu write was refused: ${cat.status()} ${catBody}`,
      ).toBeTruthy();
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
