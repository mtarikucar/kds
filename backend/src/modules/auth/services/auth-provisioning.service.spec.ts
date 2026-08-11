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

describe("AuthProvisioningService — signup no longer touches the plan rail", () => {
  // Registration used to call loadTrialPlanOrThrow() and REFUSE to create a
  // tenant when the seeded `TRIAL` SubscriptionPlan was missing. Plans are
  // retired: that made signup depend on a row nothing else reads, so deleting
  // one leftover catalogue entry during cleanup would have taken registration
  // down with it.
  it("does not expose a trial-plan loader any more", () => {
    const svc = new AuthProvisioningService(makePrisma() as any);
    expect(
      (svc as unknown as Record<string, unknown>).loadTrialPlanOrThrow,
    ).toBeUndefined();
  });

  it("creates a tenant with no plan, no subscription and no trial countdown", async () => {
    const prisma = makePrisma();
    const tx = {
      tenant: { create: jest.fn().mockResolvedValue({ id: "t-1" }) },
      subscription: { create: jest.fn() },
      subscriptionPlan: { findUnique: jest.fn() },
      branch: { create: jest.fn().mockResolvedValue({ id: "b-1" }) },
      user: { create: jest.fn().mockResolvedValue({ id: "u-1" }) },
      userBranchAssignment: { create: jest.fn() },
    };
    const svc = new AuthProvisioningService(prisma as any);

    await svc.provisionNewTenantWithAdmin(tx as any, {
      restaurantName: "Acme",
      finalSubdomain: "acme",
      userParams: {
        email: "a@b.com",
        hashedPassword: "x",
        firstName: "A",
        lastName: "B",
        userRole: "ADMIN",
        userStatus: "ACTIVE",
      } as any,
    });

    expect(tx.subscription.create).not.toHaveBeenCalled();
    expect(tx.subscriptionPlan.findUnique).not.toHaveBeenCalled();
    const data = tx.tenant.create.mock.calls[0][0].data;
    expect(data.currentPlanId).toBeUndefined();
    expect(data.trialEndsAt).toBeUndefined();
    // The one seed that mattered: an override map here would have granted the
    // paid catalogue to every new tenant.
    expect(data.featureOverrides).toBeUndefined();
  });
});

describe("AuthProvisioningService.buildPlanFeatureOverrides", () => {
  it("seeds NOTHING — the free core is projected, not overridden", () => {
    // This used to mirror the plan's TRUE feature flags onto the tenant so
    // PlanFeatureGuard's fallback resolved during the projector's warm-up.
    //
    // Under à-la-carte that seed is the single most dangerous line in
    // provisioning: the projector turns every key in this map into an
    // `override:admin` grant, so a tenant created this way would hold
    // permanent overrides for the entire paid feature set — every module,
    // free, forever, and re-asserted nightly by the reconcile cron.
    //
    // Nothing replaces it. FREE_BASELINE_GRANTS is projected for every tenant
    // unconditionally and paid products come from ownership rows, so there is
    // no warm-up window left to paper over.
    expect(new AuthProvisioningService(
      {} as any, {} as any, {} as any, {} as any,
    ).buildPlanFeatureOverrides()).toEqual({});
  });
});
