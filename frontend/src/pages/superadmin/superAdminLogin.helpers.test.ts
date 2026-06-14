import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readAndClearReturnPath,
  resolvePostLoginTarget,
} from './superAdminLogin.helpers';

describe('resolvePostLoginTarget (allow-list)', () => {
  it('returns the dashboard fallback when candidate is null', () => {
    expect(resolvePostLoginTarget(null)).toBe('/superadmin/dashboard');
  });

  it('accepts an internal /superadmin/ deeplink', () => {
    expect(resolvePostLoginTarget('/superadmin/tenants')).toBe('/superadmin/tenants');
    expect(resolvePostLoginTarget('/superadmin/plans/abc')).toBe('/superadmin/plans/abc');
  });

  it('rejects the login route itself (self-loop guard)', () => {
    expect(resolvePostLoginTarget('/superadmin/login')).toBe('/superadmin/dashboard');
    expect(resolvePostLoginTarget('/superadmin/login?next=x')).toBe('/superadmin/dashboard');
  });

  it('rejects non-superadmin internal paths', () => {
    expect(resolvePostLoginTarget('/dashboard')).toBe('/superadmin/dashboard');
    expect(resolvePostLoginTarget('/superadminx/tenants')).toBe('/superadmin/dashboard');
  });

  it('rejects protocol-relative / external-looking paths (// prefix)', () => {
    // /^\/[^/]/ requires a single leading slash followed by a non-slash char.
    expect(resolvePostLoginTarget('//evil.com')).toBe('/superadmin/dashboard');
  });

  it('rejects absolute external URLs and relative paths', () => {
    expect(resolvePostLoginTarget('https://evil.com/superadmin/')).toBe('/superadmin/dashboard');
    expect(resolvePostLoginTarget('superadmin/tenants')).toBe('/superadmin/dashboard');
  });

  it('rejects empty string', () => {
    expect(resolvePostLoginTarget('')).toBe('/superadmin/dashboard');
  });
});

describe('readAndClearReturnPath', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns null when nothing is stashed', () => {
    expect(readAndClearReturnPath()).toBeNull();
  });

  it('returns the stashed value and clears it (one-shot)', () => {
    window.sessionStorage.setItem('superAdminPostLoginReturn', '/superadmin/tenants');
    expect(readAndClearReturnPath()).toBe('/superadmin/tenants');
    // Cleared on read.
    expect(window.sessionStorage.getItem('superAdminPostLoginReturn')).toBeNull();
    // A second read sees nothing.
    expect(readAndClearReturnPath()).toBeNull();
  });

  it('returns null and swallows errors when sessionStorage throws', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readAndClearReturnPath()).toBeNull();
  });
});
