import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UserFilterDto } from "./user-filter.dto";
import { UpdateTenantOverridesDto } from "./update-tenant-overrides.dto";
import { UpdateUserRoleDto } from "./update-user-role.dto";

/**
 * Long-tail validation spec for the superadmin write/filter DTOs. Load-
 * bearing rules: filter pagination is clamped; tenant-override numbers are
 * non-negative and string-booleans coerce.
 *
 * The refund and subscription-filter blocks went with the subscription rail
 * in v3.3.2 — the DTOs they validated no longer exist.
 */
function flattenErrors(es: import("class-validator").ValidationError[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...flattenErrors(e.children ?? []),
  ]);
}
async function errs(dto: object): Promise<string[]> {
  return flattenErrors(await validate(dto));
}

describe("UserFilterDto", () => {
  it("coerces page/limit and clamps the limit to 100", async () => {
    const dto = plainToInstance(UserFilterDto, { page: "2", limit: "200" });
    expect((await errs(dto)).some((m) => /limit/.test(m))).toBe(true);
    const ok = plainToInstance(UserFilterDto, { page: "2", limit: "50" });
    expect(await errs(ok)).toEqual([]);
    expect(ok.limit).toBe(50);
  });
});

describe("UpdateTenantOverridesDto", () => {
  it("coerces nested string-boolean feature flags", async () => {
    const dto = plainToInstance(UpdateTenantOverridesDto, {
      featureOverrides: { advancedReports: "true", apiAccess: "false" },
    });
    expect(await errs(dto)).toEqual([]);
    expect(dto.featureOverrides!.advancedReports).toBe(true);
    expect(dto.featureOverrides!.apiAccess).toBe(false);
  });

  // -1 is the unlimited sentinel and a VALID override: a limit override
  // REPLACES the plan value in the engine, so without -1 an override could
  // never grant unlimited (and a 0 override could not be undone to unlimited).
  it("accepts a -1 (unlimited) limit override", async () => {
    const dto = plainToInstance(UpdateTenantOverridesDto, {
      limitOverrides: { maxBranches: -1 },
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects a limit override below -1", async () => {
    const dto = plainToInstance(UpdateTenantOverridesDto, {
      limitOverrides: { maxBranches: -2 },
    });
    expect((await errs(dto)).some((m) => /maxBranches/.test(m))).toBe(true);
  });
});

// v3.2.x incident hardening — PATCH /superadmin/users/:id/role is the safe
// replacement for the raw-DB edit that planted an invalid "OWNER" role in
// production. @IsEnum(UserRole) here is what makes that a 400 at the door
// instead of ever reaching a DB write.
describe("UpdateUserRoleDto", () => {
  it("accepts each of the 5 valid roles", async () => {
    for (const role of ["ADMIN", "MANAGER", "WAITER", "KITCHEN", "COURIER"]) {
      const dto = plainToInstance(UpdateUserRoleDto, { role });
      expect(await errs(dto)).toEqual([]);
    }
  });

  it("rejects an invalid role string (e.g. the OWNER incident value)", async () => {
    const dto = plainToInstance(UpdateUserRoleDto, { role: "OWNER" });
    expect((await errs(dto)).some((m) => /role/.test(m))).toBe(true);
  });

  it("rejects a missing role", async () => {
    const dto = plainToInstance(UpdateUserRoleDto, {});
    expect((await errs(dto)).some((m) => /role/.test(m))).toBe(true);
  });
});
