import { AuthProvisioningService } from "./auth-provisioning.service";
import { ResourceNotFoundException } from "../../../common/exceptions";

/**
 * Spec for the standalone (non-transactional) AuthProvisioningService helpers:
 *  - allocateSubdomain: returns the preferred slug when free; appends a random
 *    suffix when taken/quarantined; defaults a blank base to "restaurant"
 *  - loadBusinessPlanOrThrow: throws when the plan is missing or has no trial
 *  - buildPlanFeatureOverrides: coerces every plan flag to a strict boolean
 */
function makePrisma() {
  return {
    reservedSubdomain: { findUnique: jest.fn().mockResolvedValue(null) },
    tenant: { findUnique: jest.fn().mockResolvedValue(null) },
    subscriptionPlan: { findUnique: jest.fn() },
  };
}

describe("AuthProvisioningService.allocateSubdomain", () => {
  it("returns the preferred slug when it is free", async () => {
    const prisma = makePrisma();
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.allocateSubdomain("acme")).resolves.toBe("acme");
  });

  it('defaults a blank base to "restaurant"', async () => {
    const prisma = makePrisma();
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.allocateSubdomain("")).resolves.toBe("restaurant");
  });

  it("appends a random suffix when the preferred slug is already taken", async () => {
    const prisma = makePrisma();
    // preferred lookup returns a row (taken); suffixed candidates are free
    prisma.tenant.findUnique
      .mockResolvedValueOnce({ id: "existing" }) // preferred taken
      .mockResolvedValue(null); // candidates free
    const svc = new AuthProvisioningService(prisma as any);
    const result = await svc.allocateSubdomain("acme");
    expect(result).toMatch(/^acme-[0-9a-f]{6}$/);
  });

  it("throws after exhausting suffix attempts", async () => {
    const prisma = makePrisma();
    prisma.tenant.findUnique.mockResolvedValue({ id: "always-taken" });
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.allocateSubdomain("acme")).rejects.toThrow(
      /Could not allocate/,
    );
  });
});

describe("AuthProvisioningService.loadTrialPlanOrThrow", () => {
  // Onboarding-trial redesign: new tenants start on the dedicated TRIAL plan,
  // not BUSINESS. The guard now loads/validates the TRIAL plan.
  it("returns the TRIAL plan when seeded with a positive trial", async () => {
    const prisma = makePrisma();
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      name: "TRIAL",
      trialDays: 7,
    });
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.loadTrialPlanOrThrow()).resolves.toMatchObject({
      trialDays: 7,
    });
  });

  it("throws when the TRIAL plan is missing (seed/migration misconfig)", async () => {
    const prisma = makePrisma();
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.loadTrialPlanOrThrow()).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });

  it("throws when the TRIAL plan has no trialDays", async () => {
    const prisma = makePrisma();
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      name: "TRIAL",
      trialDays: 0,
    });
    const svc = new AuthProvisioningService(prisma as any);
    await expect(svc.loadTrialPlanOrThrow()).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });
});

describe("AuthProvisioningService.buildPlanFeatureOverrides", () => {
  const svc = new AuthProvisioningService(makePrisma() as any);

  it("emits truthy flags as true and OMITS falsy ones (so no __replace:false suppresses a purchased add-on)", () => {
    const overrides = svc.buildPlanFeatureOverrides({
      advancedReports: true,
      multiLocation: false,
      customBranding: null,
      apiAccess: undefined,
      inventoryTracking: true,
    });
    expect(overrides.advancedReports).toBe(true);
    expect(overrides.inventoryTracking).toBe(true);
    // Falsy plan features are ABSENT — NOT seeded as `false`. A false override
    // becomes an override:admin {__replace:false} grant that would later
    // suppress a legitimately-purchased marketplace add-on for that feature.
    expect(overrides).not.toHaveProperty("multiLocation");
    expect(overrides).not.toHaveProperty("customBranding");
    expect(overrides).not.toHaveProperty("apiAccess");
  });

  it("returns an empty map when the plan grants no features (nothing to over-grant)", () => {
    expect(svc.buildPlanFeatureOverrides({})).toEqual({});
  });

  it("includes posAccess=true when the plan grants POS (v3.0.7: never hide POS during warm-up)", () => {
    const overrides = svc.buildPlanFeatureOverrides({ posAccess: true });
    expect(overrides.posAccess).toBe(true);
    expect(Object.values(overrides).every((v) => v === true)).toBe(true);
  });
});
