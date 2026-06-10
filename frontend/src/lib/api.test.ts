import { describe, it, expect } from 'vitest';
import { isTenantWidePath } from './api';

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
      '/subscriptions/plans',
      '/subscriptions/current',
      '/subscriptions/effective-features',
      '/subscriptions/usage/snapshot',
      '/subscriptions/tenant/invoices',
      '/subscriptions/abc/cancel',
      '/invoices/INV-1/download',
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
