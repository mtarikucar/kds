import {
  UserRole,
  HARD_RESTRICTED_ROLES,
  isHardRestrictedRole,
} from "./roles.enum";

/**
 * Long-tail spec for the role-restriction predicate driving BranchGuard's
 * single-branch pin. Load-bearing contracts: WAITER/KITCHEN/COURIER are
 * hard-restricted; ADMIN/MANAGER are not; an unknown string is safely false
 * (not coerced to restricted).
 */
describe("roles.enum", () => {
  it("flags exactly the floor-staff roles as hard-restricted", () => {
    expect(HARD_RESTRICTED_ROLES).toEqual([
      UserRole.WAITER,
      UserRole.KITCHEN,
      UserRole.COURIER,
    ]);
  });

  it("isHardRestrictedRole returns true for restricted roles", () => {
    expect(isHardRestrictedRole(UserRole.WAITER)).toBe(true);
    expect(isHardRestrictedRole(UserRole.KITCHEN)).toBe(true);
    expect(isHardRestrictedRole(UserRole.COURIER)).toBe(true);
  });

  it("isHardRestrictedRole returns false for elevated roles", () => {
    expect(isHardRestrictedRole(UserRole.ADMIN)).toBe(false);
    expect(isHardRestrictedRole(UserRole.MANAGER)).toBe(false);
  });

  it("isHardRestrictedRole is safe for an unknown string", () => {
    expect(isHardRestrictedRole("SUPERADMIN")).toBe(false);
    expect(isHardRestrictedRole("")).toBe(false);
  });
});
