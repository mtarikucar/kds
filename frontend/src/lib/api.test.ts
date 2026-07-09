import { describe, it, expect } from 'vitest';
import { isTenantWidePath, isAuthCredentialPath } from './api';

/**
 * Guards the frontend's client-side branch-scope gate. The interceptor sends
 * X-Branch-Id on every branch-scoped request and rejects it client-side when
 * no branch is resolved; tenant-level paths must be classified as "tenant-wide"
 * so they fly without a branch. The regression that prompted this: '/menu/*'
 * collided with the '/me' prefix under a naive substring match.
 */
describe('isTenantWidePath', () => {
  it('classifies account / tenant-level paths as tenant-wide', () => {
    for (const url of [
      '/auth/login',
      '/billing/portal',
      '/branches',
      '/branches/abc',
      '/users/me',
      '/users/me/profile',
      '/v1/entitlements/me',
      '/superadmin/tenants',
      // bare create route: api.post('/subscriptions') — the whole controller
      // is class-level @SkipBranchScope, so the base path must fly too.
      '/subscriptions',
      '/subscriptions/plans',
      '/subscriptions/current',
      '/subscriptions/effective-features',
      '/subscriptions/usage/snapshot',
      '/subscriptions/tenant/invoices',
      '/subscriptions/abc/cancel',
      '/invoices/INV-1/download',
      // pos-settings is class-level @SkipBranchScope on the backend
      // (one settings row per tenant) — it must fly without X-Branch-Id.
      '/pos-settings',
      // The public tenant list drives the registration "select restaurant"
      // dropdown — it is fetched UNAUTHENTICATED (no branch resolved), so it
      // must fly without X-Branch-Id or the interceptor rejects it and the
      // dropdown is stuck disabled.
      '/tenants/public',
    ]) {
      expect(isTenantWidePath(url), url).toBe(true);
    }
  });

  it('classifies branch-scoped paths as NOT tenant-wide (must carry X-Branch-Id)', () => {
    for (const url of [
      '/menu/categories', // regression: '/menu' must NOT match the '/me' prefix
      '/menu/categories/abc',
      '/menu/products',
      '/menu/products/1/images',
      '/orders',
      '/tables',
      // '/tenants/settings' is NOT public/tenant-wide here — it loads post-auth
      // once a branch is resolved, so the bare '/tenants/public' exemption must
      // not accidentally widen to all of /tenants.
      '/tenants/settings',
    ]) {
      expect(isTenantWidePath(url), url).toBe(false);
    }
  });

  it('strips the query string before matching', () => {
    expect(isTenantWidePath('/subscriptions/plans?cycle=YEARLY')).toBe(true);
    expect(isTenantWidePath('/menu/categories?foo=bar')).toBe(false);
  });

  it('returns false for an undefined url', () => {
    expect(isTenantWidePath(undefined)).toBe(false);
  });
});

/**
 * Guards the response interceptor's "don't treat a bad credential as an expired
 * session" rule. A 401 from the @Public auth endpoints must reject straight
 * through (so the login form's "Invalid email or password" toast shows) rather
 * than firing /auth/refresh and hard-reloading to /login — which wiped the
 * toast and looked like a mysterious "logs in but bounces back to login".
 */
describe('isAuthCredentialPath', () => {
  it('matches the @Public credential endpoints (a 401 here = bad input, not expiry)', () => {
    for (const url of [
      '/auth/login',
      '/auth/register',
      '/auth/google',
      '/auth/apple',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/verify-email',
      '/auth/refresh',
      // full absolute form (axios may hand us baseURL + path)
      'https://hummytummy.com/api/auth/login',
      '/auth/login?foo=bar',
    ]) {
      expect(isAuthCredentialPath(url), url).toBe(true);
    }
  });

  it('does NOT match authenticated auth routes — a 401 there IS an expired session', () => {
    for (const url of [
      '/auth/logout',
      '/auth/profile',
      '/auth/complete-profile',
      '/auth/change-password',
      '/auth/resend-verification',
      '/auth/demo-session',
      // unrelated data routes
      '/orders',
      '/menu/categories',
      undefined,
    ]) {
      expect(isAuthCredentialPath(url), String(url)).toBe(false);
    }
  });
});
