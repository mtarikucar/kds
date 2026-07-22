import { describe, it, expect, beforeEach } from 'vitest';
import { useBranchScopeStore } from './branchScopeStore';
import { UserRole } from '../types';
import type { User } from '../types';

/**
 * Regression guard for the active-branch single-source-of-truth. This store is
 * a load-bearing multi-tenant isolation surface: it decides which branchId every
 * authenticated request carries, pins hard-restricted roles, and wipes state on
 * a same-device tenant switch. Before this suite it had zero coverage.
 */
function makeUser(overrides: Partial<User>): User {
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

describe('branchScopeStore', () => {
  beforeEach(() => {
    // Reset the persisted store between tests (jsdom localStorage is shared).
    useBranchScopeStore.getState().clear();
    localStorage.clear();
  });

  describe('hydrateFromUser', () => {
    it('pins hard-restricted roles (WAITER) to primaryBranchId', () => {
      useBranchScopeStore.getState().hydrateFromUser(
        makeUser({ role: UserRole.WAITER, primaryBranchId: 'b-9', allowedBranchIds: [] }),
      );
      const s = useBranchScopeStore.getState();
      expect(s.isPinned).toBe(true);
      expect(s.branchId).toBe('b-9');
    });

    it('seeds a roaming ADMIN/MANAGER to primaryBranchId when no prior selection', () => {
      useBranchScopeStore.getState().hydrateFromUser(makeUser({ role: UserRole.MANAGER }));
      const s = useBranchScopeStore.getState();
      expect(s.isPinned).toBe(false);
      expect(s.branchId).toBe('b-1');
    });

    it('keeps a roaming user’s prior in-allow-list selection across re-hydration', () => {
      const store = useBranchScopeStore.getState();
      store.hydrateFromUser(makeUser({})); // → b-1
      store.setBranchId('b-2'); // user roams to b-2
      store.hydrateFromUser(makeUser({})); // same user logs back in
      expect(useBranchScopeStore.getState().branchId).toBe('b-2');
    });

    it('falls back to primaryBranchId when the prior selection is no longer allowed', () => {
      const store = useBranchScopeStore.getState();
      store.hydrateFromUser(makeUser({})); // allowed [b-1,b-2], → b-1
      store.setBranchId('b-2');
      // Re-hydrate with a narrowed allow-list that no longer contains b-2.
      store.hydrateFromUser(makeUser({ allowedBranchIds: ['b-1'], primaryBranchId: 'b-1' }));
      expect(useBranchScopeStore.getState().branchId).toBe('b-1');
    });

    it('wipes the prior tenant’s branchId on a same-device tenant switch', () => {
      const store = useBranchScopeStore.getState();
      store.hydrateFromUser(makeUser({ tenantId: 't-1', primaryBranchId: 'b-1' }));
      store.setBranchId('b-2');
      // A different tenant logs in on the same device.
      store.hydrateFromUser(
        makeUser({ tenantId: 't-2', primaryBranchId: 'b-7', allowedBranchIds: ['b-7', 'b-8'] }),
      );
      const s = useBranchScopeStore.getState();
      expect(s.tenantId).toBe('t-2');
      expect(s.branchId).toBe('b-7'); // NOT t-1's b-2
    });

    it('clears everything when the user logs out (null)', () => {
      useBranchScopeStore.getState().hydrateFromUser(makeUser({}));
      useBranchScopeStore.getState().hydrateFromUser(null);
      const s = useBranchScopeStore.getState();
      expect(s).toMatchObject({ branchId: null, allowedBranchIds: [], isPinned: false, tenantId: null });
    });
  });

  describe('setBranchId', () => {
    it('refuses to roam a pinned (WAITER) user off their primary branch', () => {
      useBranchScopeStore.getState().hydrateFromUser(
        makeUser({ role: UserRole.WAITER, primaryBranchId: 'b-1', allowedBranchIds: [] }),
      );
      useBranchScopeStore.getState().setBranchId('b-2');
      expect(useBranchScopeStore.getState().branchId).toBe('b-1'); // no-op
    });

    it('refuses a target outside the JWT allow-list', () => {
      useBranchScopeStore.getState().hydrateFromUser(makeUser({})); // allowed [b-1,b-2]
      useBranchScopeStore.getState().setBranchId('b-99');
      expect(useBranchScopeStore.getState().branchId).toBe('b-1'); // unchanged
    });

    it('allows a roaming user to switch within the allow-list', () => {
      useBranchScopeStore.getState().hydrateFromUser(makeUser({}));
      useBranchScopeStore.getState().setBranchId('b-2');
      expect(useBranchScopeStore.getState().branchId).toBe('b-2');
    });
  });
});

/**
 * Branch-select screen (2026-07-22): `branchChosen` marks an EXPLICIT user
 * selection. The first-entry gate forces /branch-select only while it is
 * false; auto-seeding primaryBranchId during hydration must NOT count.
 */
describe('branchChosen flag', () => {
  beforeEach(() => {
    // This describe sits outside the main suite's beforeEach scope.
    useBranchScopeStore.getState().clear();
    localStorage.clear();
  });

  it('is false after hydration alone (auto-seed is not a choice)', () => {
    useBranchScopeStore.getState().hydrateFromUser(makeUser({}));
    expect(useBranchScopeStore.getState().branchChosen).toBe(false);
  });

  it('becomes true when the user explicitly selects a branch', () => {
    const store = useBranchScopeStore.getState();
    store.hydrateFromUser(makeUser({}));
    store.setBranchId('b-2');
    expect(useBranchScopeStore.getState().branchChosen).toBe(true);
  });

  it('stays false when a pinned role attempts a selection (no-op path)', () => {
    const store = useBranchScopeStore.getState();
    store.hydrateFromUser(
      makeUser({ role: UserRole.WAITER, primaryBranchId: 'b-9', allowedBranchIds: [] }),
    );
    store.setBranchId('b-2');
    expect(useBranchScopeStore.getState().branchChosen).toBe(false);
  });

  it('resets on clear (logout)', () => {
    const store = useBranchScopeStore.getState();
    store.hydrateFromUser(makeUser({}));
    store.setBranchId('b-2');
    store.clear();
    expect(useBranchScopeStore.getState().branchChosen).toBe(false);
  });

  it('resets on a same-device tenant switch', () => {
    const store = useBranchScopeStore.getState();
    store.hydrateFromUser(makeUser({}));
    store.setBranchId('b-2');
    store.hydrateFromUser(
      makeUser({ tenantId: 't-OTHER', primaryBranchId: 'x-1', allowedBranchIds: ['x-1', 'x-2'] }),
    );
    expect(useBranchScopeStore.getState().branchChosen).toBe(false);
  });

  it('survives re-hydration for the same tenant (login keeps the choice)', () => {
    const store = useBranchScopeStore.getState();
    store.hydrateFromUser(makeUser({}));
    store.setBranchId('b-2');
    store.hydrateFromUser(makeUser({}));
    expect(useBranchScopeStore.getState().branchChosen).toBe(true);
  });

  it('migrates a legacy persisted snapshot with a branchId as already-chosen', async () => {
    localStorage.setItem(
      'branch-scope-storage',
      JSON.stringify({
        state: { branchId: 'b-2', allowedBranchIds: ['b-1', 'b-2'], isPinned: false, tenantId: 't-1' },
        version: 0,
      }),
    );
    await useBranchScopeStore.persist.rehydrate();
    expect(useBranchScopeStore.getState().branchChosen).toBe(true);
  });

  it('migrates a legacy snapshot WITHOUT a branchId as not-chosen', async () => {
    localStorage.setItem(
      'branch-scope-storage',
      JSON.stringify({
        state: { branchId: null, allowedBranchIds: [], isPinned: false, tenantId: 't-1' },
        version: 0,
      }),
    );
    await useBranchScopeStore.persist.rehydrate();
    expect(useBranchScopeStore.getState().branchChosen).toBe(false);
  });

  it('persists an explicit choice across a fresh-store reload (v1 round-trip)', async () => {
    const store = useBranchScopeStore.getState();
    store.hydrateFromUser(makeUser({}));
    store.setBranchId('b-2'); // writes a current-version snapshot to localStorage
    const persisted = localStorage.getItem('branch-scope-storage');

    // Simulate a page reload: a fresh store starts at its initial values, then
    // the persist middleware rehydrates from what was persisted. If branchChosen
    // were dropped from partialize, this is where the reload would re-force the
    // selection screen — the merge cannot restore what was never written.
    // (Restore the snapshot because the setState below overwrites localStorage.)
    useBranchScopeStore.setState({ branchChosen: false, branchId: null });
    localStorage.setItem('branch-scope-storage', persisted!);
    await useBranchScopeStore.persist.rehydrate();

    const s = useBranchScopeStore.getState();
    expect(s.branchId).toBe('b-2');
    expect(s.branchChosen).toBe(true);
  });
});
