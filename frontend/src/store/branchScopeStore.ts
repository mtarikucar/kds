import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';
import { isHardRestrictedRole } from '../types/roles';

/**
 * v3.0.0 — single source of truth for the active branch context.
 *
 * Replaces the legacy `uiStore.activeBranchId` field. Splitting branch
 * state out from UI preferences gives us:
 *   - a clean place for cross-store-side-effect-free hydration from
 *     the user's login response,
 *   - tenant-keyed persistence so logging into a second tenant on
 *     the same device cannot bleed the prior tenant's branchId
 *     selection into the new session,
 *   - a TanStack-Query-compatible reactive surface that lets every
 *     hook bake `branchId` into its query key automatically.
 *
 * Architectural contract:
 *   - WAITER / KITCHEN / COURIER are pinned (`isPinned=true`) to
 *     primaryBranchId by `hydrateFromUser`. The picker disables
 *     itself for them; calling `setBranchId()` with a non-primary
 *     id is a no-op.
 *   - ADMIN / MANAGER may roam through allowedBranches. Empty
 *     allowedBranchIds[] + role=ADMIN is the wildcard owner case;
 *     `branchId` is then seeded to `primaryBranchId` (which the
 *     backend always populates for owner accounts).
 */
type BranchScopeState = {
  /** Active branch — every branch-scoped request reads this. */
  branchId: string | null;
  /** allow-list from the JWT (for the BranchPicker dropdown). */
  allowedBranchIds: string[];
  /** True for WAITER/KITCHEN/COURIER. Disables BranchPicker. */
  isPinned: boolean;
  /** Tenant the persisted state belongs to (cross-tenant guard). */
  tenantId: string | null;
  /**
   * True only after an EXPLICIT user selection (BranchPicker / the
   * /branch-select screen). Auto-seeding primaryBranchId during
   * hydration does NOT set it — the first-entry BranchSelectionGate
   * forces /branch-select while this is false for multi-branch users.
   */
  branchChosen: boolean;

  hydrateFromUser: (user: User | null) => void;
  setBranchId: (id: string) => void;
  clear: () => void;
};

export const useBranchScopeStore = create<BranchScopeState>()(
  persist(
    (set, get) => ({
      branchId: null,
      allowedBranchIds: [],
      isPinned: false,
      tenantId: null,
      branchChosen: false,

      hydrateFromUser: (user) => {
        if (!user) {
          set({
            branchId: null,
            allowedBranchIds: [],
            isPinned: false,
            tenantId: null,
            branchChosen: false,
          });
          return;
        }
        const current = get();
        // Tenant transition guard: if the persisted snapshot was for
        // a different tenant, wipe it before hydrating. Same-device
        // account switch cannot leak the prior tenant's branchId
        // into the new session's first request.
        if (current.tenantId && current.tenantId !== user.tenantId) {
          set({
            branchId: null,
            allowedBranchIds: [],
            isPinned: false,
            tenantId: null,
            branchChosen: false,
          });
        }
        const pinned = isHardRestrictedRole(user.role);
        const allowed = user.allowedBranchIds ?? [];
        let nextBranchId: string | null = pinned
          ? user.primaryBranchId
          : current.branchId;
        // For non-pinned users, fall back to primaryBranchId when no
        // prior selection survives the tenant guard.
        if (!pinned && (!nextBranchId || !allowed.includes(nextBranchId))) {
          nextBranchId =
            user.primaryBranchId ?? allowed[0] ?? null;
        }
        set({
          branchId: nextBranchId,
          allowedBranchIds: allowed,
          isPinned: pinned,
          tenantId: user.tenantId,
          // Preserved across same-tenant re-logins; the tenant-switch wipe
          // above (and the null-user reset) are the only things clearing it.
          branchChosen: get().branchChosen,
        });
      },

      setBranchId: (id) => {
        const { isPinned, allowedBranchIds } = get();
        if (isPinned) return; // hard-restricted: no-op.
        if (allowedBranchIds.length > 0 && !allowedBranchIds.includes(id)) {
          return; // outside allow-list: refuse.
        }
        set({ branchId: id, branchChosen: true });
      },

      clear: () =>
        set({
          branchId: null,
          allowedBranchIds: [],
          isPinned: false,
          tenantId: null,
          branchChosen: false,
        }),
    }),
    {
      name: 'branch-scope-storage',
      version: 1,
      // v0 snapshots predate `branchChosen`. A device that already carries a
      // branchId selected it under the old UI — count that as chosen so
      // existing users never get the forced /branch-select screen.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<BranchScopeState>;
        return {
          branchId: state.branchId ?? null,
          allowedBranchIds: state.allowedBranchIds ?? [],
          isPinned: state.isPinned ?? false,
          tenantId: state.tenantId ?? null,
          branchChosen:
            version === 0
              ? state.branchId != null
              : (state.branchChosen ?? false),
        };
      },
      partialize: (state) => ({
        branchId: state.branchId,
        allowedBranchIds: state.allowedBranchIds,
        isPinned: state.isPinned,
        tenantId: state.tenantId,
        branchChosen: state.branchChosen,
      }),
    },
  ),
);
