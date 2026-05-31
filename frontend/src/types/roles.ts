import { UserRole } from './index';

/**
 * v3.0.0 — roles BranchGuard pins to a single branch.
 *
 * Mirrors backend's `HARD_RESTRICTED_ROLES` constant in
 * `backend/src/common/constants/roles.enum.ts`. The duplicate-magic-
 * string the audit flagged in the prior commit is gone: both sides
 * import from a single named constant.
 *
 * The BranchPicker renders a locked badge (not a dropdown) for users
 * whose role is in this list, and the axios interceptor short-circuits
 * any X-Branch-Id change attempt that would target a non-primary
 * branch — the server enforcement is mirrored client-side to avoid the
 * extra round-trip.
 */
export const HARD_RESTRICTED_ROLES: readonly string[] = [
  UserRole.WAITER,
  UserRole.KITCHEN,
  UserRole.COURIER,
];

export function isHardRestrictedRole(role: string | undefined | null): boolean {
  return !!role && HARD_RESTRICTED_ROLES.includes(role);
}
