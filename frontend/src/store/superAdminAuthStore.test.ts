import { beforeEach, describe, expect, it } from 'vitest';
import { useSuperAdminAuthStore } from './superAdminAuthStore';
import type { SuperAdmin } from '../features/superadmin/types';

const admin = {
  id: 'sa-1',
  email: 'root@example.com',
} as SuperAdmin;

describe('superAdminAuthStore', () => {
  beforeEach(() => {
    useSuperAdminAuthStore.getState().logout();
    localStorage.clear();
  });

  it('login sets the full authenticated state and clears 2FA flags', () => {
    const store = useSuperAdminAuthStore.getState();
    store.setTempToken('temp-token');
    store.login(admin, 'access', 'refresh');

    const state = useSuperAdminAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.superAdmin).toEqual(admin);
    expect(state.accessToken).toBe('access');
    expect(state.refreshToken).toBe('refresh');
    expect(state.tempToken).toBeNull();
    expect(state.requires2FA).toBe(false);
    expect(state.requires2FASetup).toBe(false);
  });

  it('setTempToken toggles requires2FA vs requires2FASetup', () => {
    useSuperAdminAuthStore.getState().setTempToken('t1');
    expect(useSuperAdminAuthStore.getState().requires2FA).toBe(true);
    expect(useSuperAdminAuthStore.getState().requires2FASetup).toBe(false);

    useSuperAdminAuthStore.getState().setTempToken('t2', true);
    expect(useSuperAdminAuthStore.getState().requires2FA).toBe(false);
    expect(useSuperAdminAuthStore.getState().requires2FASetup).toBe(true);
  });

  it('logout clears everything', () => {
    const store = useSuperAdminAuthStore.getState();
    store.login(admin, 'access', 'refresh');
    store.logout();

    const state = useSuperAdminAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.superAdmin).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.refreshToken).toBeNull();
  });

  it('never persists tokens to storage (XSS containment contract)', () => {
    useSuperAdminAuthStore.getState().login(admin, 'access', 'refresh');

    const raw = localStorage.getItem('superadmin-auth-storage');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.superAdmin).toEqual(admin);
    expect(persisted.state.isAuthenticated).toBe(true);
    // The whole point of the partialize in this store — see
    // docs/reviews/frontend-auth-stores.md F-1.
    expect(persisted.state.accessToken).toBeUndefined();
    expect(persisted.state.refreshToken).toBeUndefined();
    expect(persisted.state.tempToken).toBeUndefined();
  });
});
