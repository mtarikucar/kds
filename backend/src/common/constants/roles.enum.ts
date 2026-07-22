export enum UserRole {
  ADMIN = "ADMIN",
  MANAGER = "MANAGER",
  WAITER = "WAITER",
  KITCHEN = "KITCHEN",
  COURIER = "COURIER",
}

/**
 * v3.0.0 — roles that BranchGuard pins to a single branch.
 *
 * The constraint cascades through the system:
 *   - Users with these roles cannot exist without a primaryBranchId
 *     (enforced by the DB CHECK constraint
 *     `users_restricted_role_requires_primary_branch`).
 *   - BranchGuard refuses to let them target any branch other than
 *     their primaryBranchId — the X-Branch-Id header is honoured only
 *     when it matches.
 *   - The frontend BranchPicker disables itself for these roles and
 *     renders a static "locked" badge.
 *
 * Mirror this list to `frontend/src/types/roles.ts`. The audit flagged
 * the duplicate-magic-string in prior versions; both sides import from
 * their respective single constants now.
 */
export const HARD_RESTRICTED_ROLES: readonly UserRole[] = [
  UserRole.WAITER,
  UserRole.KITCHEN,
  UserRole.COURIER,
];

export function isHardRestrictedRole(role: string): boolean {
  return (HARD_RESTRICTED_ROLES as readonly string[]).includes(role);
}

/**
 * v3.2.x incident hardening — a support engineer once wrote an invalid
 * role string ("OWNER") directly into Postgres (raw DB / Prisma Studio),
 * bypassing every application write path's `@IsEnum(UserRole)` validation.
 * The DB column itself has no value constraint (see the
 * `users_role_valid` CHECK constraint migration), so JwtStrategy.validate
 * uses this to fail loudly at auth time instead of the account silently
 * producing a 403 storm with no diagnostic anywhere.
 */
export function isValidUserRole(role: string): role is UserRole {
  return (Object.values(UserRole) as string[]).includes(role);
}
