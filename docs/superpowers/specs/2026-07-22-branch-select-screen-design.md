# Branch Selection Screen + First-Entry Gate

**Date:** 2026-07-22 · **Branch:** `feat/branch-select-screen` (own worktree; PR only — user merges all open work themselves)
**Approved:** hub stays its own page, linked from the selection screen (terminal A/B/C).

## Requirements (user)

1. A dedicated branch-switching screen; the sidebar "Şubeler" entry moves there (sidebar loses it).
2. The navbar branch area gets a "Şube değiştir" button.
3. First entry: if no locally cached prior branch selection AND the user has multiple branches → force the selection screen. Single-branch tenants and users with a cached selection never see it.

## Design

- **`/branch-select`** — full-screen route (ProtectedRoute, outside Layout, like `/welcome`). Branch cards (name, code chip, HQ/status badge, active check) from `useListBranches`, filtered by `allowedBranchIds` (empty list + ADMIN = all), selectable only when `status === 'active'`. Click → `setBranchId` → navigate to `state.from ?? /dashboard`. ADMIN/MANAGER see a "Şubeleri Yönet" link → `/admin/branches` (hub unchanged). In forced mode (no prior choice) there is no back affordance; voluntary visits get one.
- **`branchScopeStore`**: new persisted `branchChosen` flag. `setBranchId` sets it true; `clear`/logout resets; tenant-switch wipe resets. Persist `version: 1` + `migrate`: legacy snapshots with a non-null `branchId` count as chosen (existing users never see the forced screen).
- **`BranchSelectionGate`** (mounted in Layout: ProfileCompletionGate → SubscriptionGate → BranchSelectionGate): redirects to `/branch-select` when profile+branches are loaded, `hasFeature('multiLocation')`, `!isPinned`, visible branches > 1, and `!branchChosen`. Loading states render children (no flash-redirect), mirroring ProfileCompletionGate.
- **`BranchPicker`** (navbar): dropdown replaced by active-branch chip + "Şube değiştir" button navigating to `/branch-select` with `state.from`. Pinned-role locked badge and ≤1-branch hiding rules unchanged.
- **Sidebar**: `multiBranch` group deleted; "Sistem Sağlığı" moves into "Ayarlar & Erişim". `/admin/branches` stays routed (reachable from the selection screen).
- **i18n**: new keys mirrored to all 5 locales (en/tr/ru/uz/ar); reuse existing `branchPicker.*`/`hummytummy.branches.*` where possible.

## Tests

Store: migrate legacy→chosen, setBranchId sets flag, tenant-switch resets. Gate: redirects only in the exact condition set (not pinned / not single-branch / not chosen / not loading). Page: renders allowed branches, click selects + marks chosen + navigates, suspended branch not selectable, manage link role-gated. Picker: button navigates, pinned badge intact.
