import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './authStore';
import { UserRole } from '../types';
import type { User } from '../types';

/**
 * Regression guard for the primary admin session/identity store. It enforces a
 * split-persistence security model: the in-memory accessToken must NEVER reach
 * localStorage (XSS containment), while user + isAuthenticated ARE persisted so
 * the authenticated shell can paint before the refresh handshake. logout() must
 * also actively wipe the persisted snapshot so a logout→relogin on the same
 * device can't surface the previous identity. Before this suite: zero coverage.
 */
function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u-1',
    email: 'u@example.com',
    firstName: 'T',
    lastName: 'U',
    role: UserRole.MANAGER,
    tenantId: 't-1',
    primaryBranchId: 'b-1',
    allowedBranchIds: ['b-1', 'b-2'],
    ...overrides,
  } as User;
}

describe('authStore', () => {
  beforeEach(() => {
    // jsdom localStorage is shared across tests; start every test clean.
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it('starts unauthenticated with no user and no token', () => {
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });

  it('login sets user, accessToken, and flips isAuthenticated', () => {
    const user = makeUser();
    useAuthStore.getState().login(user, 'access-1');

    const s = useAuthStore.getState();
    expect(s.user).toEqual(user);
    expect(s.accessToken).toBe('access-1');
    expect(s.isAuthenticated).toBe(true);
  });

  it('setUser marks authenticated without touching the token', () => {
    const user = makeUser();
    useAuthStore.getState().setUser(user);

    const s = useAuthStore.getState();
    expect(s.user).toEqual(user);
    expect(s.isAuthenticated).toBe(true);
    expect(s.accessToken).toBeNull(); // setUser is identity-only
  });

  it('setAccessToken rotates the in-memory token without disturbing user/auth flag', () => {
    const user = makeUser();
    useAuthStore.getState().login(user, 'access-1');
    useAuthStore.getState().setAccessToken('access-2'); // e.g. silent refresh

    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('access-2');
    expect(s.user).toEqual(user);
    expect(s.isAuthenticated).toBe(true);
  });

  it('logout nulls user, token, and isAuthenticated', () => {
    useAuthStore.getState().login(makeUser(), 'access-1');
    useAuthStore.getState().logout();

    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.isAuthenticated).toBe(false);
  });

  it('persists user + isAuthenticated but NEVER the accessToken (XSS containment)', () => {
    const user = makeUser();
    useAuthStore.getState().login(user, 'secret-access-token');

    const raw = localStorage.getItem('auth-storage');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.user).toEqual(user);
    expect(persisted.state.isAuthenticated).toBe(true);
    // The whole point of partialize: the token is memory-only.
    expect(persisted.state.accessToken).toBeUndefined();
    // belt-and-braces: the secret must not appear anywhere in storage.
    expect(raw).not.toContain('secret-access-token');
  });

  it('logout actively removes the persisted snapshot (v2.8.97 stale-identity fix)', () => {
    useAuthStore.getState().login(makeUser({ email: 'first@example.com' }), 'access-1');
    expect(localStorage.getItem('auth-storage')).not.toBeNull();

    useAuthStore.getState().logout();

    // The storage key is dropped entirely, not just rewritten with nulls,
    // so the boot path sees a clean slate before the next login lands.
    expect(localStorage.getItem('auth-storage')).toBeNull();
  });

  it('a logout→relogin on the same device does not leak the prior identity', () => {
    useAuthStore.getState().login(makeUser({ email: 'first@example.com' }), 'access-1');
    useAuthStore.getState().logout();
    useAuthStore.getState().login(makeUser({ email: 'second@example.com', id: 'u-2' }), 'access-2');

    const persisted = JSON.parse(localStorage.getItem('auth-storage') as string);
    expect(persisted.state.user.email).toBe('second@example.com');
    expect(persisted.state.user.id).toBe('u-2');
    expect(useAuthStore.getState().user?.email).toBe('second@example.com');
  });

  describe('demo mode', () => {
    const demoUser = makeUser({
      id: 'demo-1',
      email: 'demo-admin@demo.hummytummy.local',
      tenantId: 'demo-tenant',
      primaryBranchId: 'demo-branch',
      allowedBranchIds: [],
      isDemo: true,
    });

    it('enterDemo swaps the active user/token to the demo and flags demoMode', () => {
      useAuthStore.getState().login(makeUser({ email: 'real@x.com' }), 'real-token');
      useAuthStore.getState().enterDemo(demoUser, 'demo-token');

      const s = useAuthStore.getState();
      expect(s.demoMode).toBe(true);
      expect(s.user?.email).toBe('demo-admin@demo.hummytummy.local');
      expect(s.accessToken).toBe('demo-token');
      // real session stashed in memory for exit
      expect(s.realSession?.user?.email).toBe('real@x.com');
      expect(s.realSession?.accessToken).toBe('real-token');
    });

    it('exitDemo restores the stashed real session and clears demoMode', () => {
      useAuthStore.getState().login(makeUser({ email: 'real@x.com' }), 'real-token');
      useAuthStore.getState().enterDemo(demoUser, 'demo-token');
      useAuthStore.getState().exitDemo();

      const s = useAuthStore.getState();
      expect(s.demoMode).toBe(false);
      expect(s.realSession).toBeNull();
      expect(s.user?.email).toBe('real@x.com');
      expect(s.accessToken).toBe('real-token');
    });

    it('double enterDemo does not overwrite the stashed real session', () => {
      useAuthStore.getState().login(makeUser({ email: 'real@x.com' }), 'real-token');
      useAuthStore.getState().enterDemo(demoUser, 'demo-token-1');
      // a second entry (e.g. button double-tap) must keep the ORIGINAL real
      // session, not stash the demo session as the thing to restore.
      useAuthStore.getState().enterDemo(demoUser, 'demo-token-2');

      const s = useAuthStore.getState();
      expect(s.realSession?.user?.email).toBe('real@x.com');
      expect(s.realSession?.accessToken).toBe('real-token');
      useAuthStore.getState().exitDemo();
      expect(useAuthStore.getState().user?.email).toBe('real@x.com');
      expect(useAuthStore.getState().accessToken).toBe('real-token');
    });

    it('NEVER persists the demo identity or token — reload drops to the real user', () => {
      useAuthStore.getState().login(makeUser({ email: 'real@x.com' }), 'real-token');
      useAuthStore.getState().enterDemo(demoUser, 'demo-token');

      const raw = localStorage.getItem('auth-storage') as string;
      const persisted = JSON.parse(raw);
      // partialize keeps the REAL user while in demo, never the demo user.
      expect(persisted.state.user.email).toBe('real@x.com');
      expect(persisted.state.demoMode).toBeUndefined();
      expect(persisted.state.realSession).toBeUndefined();
      expect(raw).not.toContain('demo-token');
      expect(raw).not.toContain('demo-admin@demo.hummytummy.local');
    });

    it('logout from within demo clears demoMode and realSession', () => {
      useAuthStore.getState().login(makeUser({ email: 'real@x.com' }), 'real-token');
      useAuthStore.getState().enterDemo(demoUser, 'demo-token');
      useAuthStore.getState().logout();

      const s = useAuthStore.getState();
      expect(s.demoMode).toBe(false);
      expect(s.realSession).toBeNull();
      expect(s.user).toBeNull();
      expect(s.accessToken).toBeNull();
    });
  });
});
