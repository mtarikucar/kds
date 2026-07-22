import {
  UserRole,
  HARD_RESTRICTED_ROLES,
  isHardRestrictedRole,
  isValidUserRole,
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

  /**
   * v3.2.x incident — a support engineer wrote an invalid role string
   * ("OWNER") directly into Postgres, bypassing every application write
   * path's @IsEnum(UserRole) validation. isValidUserRole is the runtime
   * predicate JwtStrategy uses to catch that structurally-invalid account
   * loudly at auth time instead of a silent 403 storm.
   */
  describe("isValidUserRole", () => {
    it("returns true for all 5 valid roles", () => {
      expect(isValidUserRole(UserRole.ADMIN)).toBe(true);
      expect(isValidUserRole(UserRole.MANAGER)).toBe(true);
      expect(isValidUserRole(UserRole.WAITER)).toBe(true);
      expect(isValidUserRole(UserRole.KITCHEN)).toBe(true);
      expect(isValidUserRole(UserRole.COURIER)).toBe(true);
    });

    it("returns false for the invalid legacy OWNER role", () => {
      expect(isValidUserRole("OWNER")).toBe(false);
    });

    it("returns false for an empty string", () => {
      expect(isValidUserRole("")).toBe(false);
    });

    it("returns false for a lowercase variant (case-sensitive)", () => {
      expect(isValidUserRole("admin")).toBe(false);
    });
  });
});
