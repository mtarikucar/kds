import { Prisma } from "@prisma/client";
import { TenantProvisioningService } from "./tenant-provisioning.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import {
  CoreProvisioningEmailInUseError,
  CoreProvisioningPlanInvalidError,
  ProvisionTenantForLeadCommand,
} from "../../core-contracts/provisioning/tenant-provisioning.types";

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("$hashed$"),
}));
jest.mock("../../common/helpers/subdomain.helper", () => ({
  isSubdomainQuarantined: jest.fn().mockResolvedValue(false),
  randomSubdomainSuffix: jest.fn().mockReturnValue("abc123"),
}));

/**
 * TenantProvisioningService owns the CORE writes that used to live inside
 * MarketingLeadsService.convert. The security-relevant invariants are
 * idempotency (one tenant per lead, even under retry/race) and the typed
 * port errors that keep the caller framework-neutral.
 */
describe("TenantProvisioningService", () => {
  let prisma: MockPrismaClient;
  let config: { get: jest.Mock };
  let svc: TenantProvisioningService;

  const command: ProvisionTenantForLeadCommand = {
    leadId: "lead-1",
    idempotencyKey: "lead-convert:lead-1",
    tenantName: "Test Bistro",
    admin: { email: "owner@test.com", firstName: "Ada", lastName: "Lovelace" },
    plan: { planId: "plan-pro", amountOverride: null, trialDaysOverride: null },
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    config = { get: jest.fn().mockReturnValue(undefined) }; // bcryptCost → default 12
    svc = new TenantProvisioningService(prisma as any, config as any);

    // Forward the $transaction callback onto the same mock surface.
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn(prisma),
    );

    // Happy-path defaults (individual tests override as needed).
    prisma.tenantProvisioningLog.findUnique.mockResolvedValue(null as any);
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
      trialDays: 14,
      commissionRate: new Prisma.Decimal(0.15),
    } as any);
    prisma.user.findUnique.mockResolvedValue(null as any); // no email collision
    prisma.tenant.findUnique.mockResolvedValue(null as any); // subdomain free
    prisma.tenant.create.mockResolvedValue({
      id: "tenant-1",
      subdomain: "test-bistro",
    } as any);
    // deep-review H7: provisioning now seeds a Main branch and points the
    // admin's primaryBranchId at it (new-tenant parity), so mock branch.create.
    prisma.branch.create.mockResolvedValue({ id: "branch-main" } as any);
    prisma.user.create.mockResolvedValue({ id: "admin-1" } as any);
    prisma.subscription.create.mockResolvedValue({ id: "sub-1" } as any);
    prisma.tenantProvisioningLog.create.mockResolvedValue({} as any);
  });

  it("provisions tenant + admin + subscription + ledger and returns plan facts (created)", async () => {
    const res = await svc.provisionTenantForLead(command);

    expect(res.created).toBe(true);
    expect(res).toMatchObject({
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      subscriptionId: "sub-1",
    });
    expect(res.adminTempPassword).not.toBe("");
    expect(res.planFacts).toEqual({
      monthlyPrice: 1299,
      commissionRate: 0.15,
      planCode: "PRO",
    });
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    // H7: a Main branch is seeded and the admin's primaryBranchId points at it
    // so the converted tenant isn't bricked (null primaryBranchId).
    expect(prisma.branch.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ primaryBranchId: "branch-main" }),
      }),
    );
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
    expect(prisma.tenantProvisioningLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leadId: "lead-1",
          tenantId: "tenant-1",
          idempotencyKey: "lead-convert:lead-1",
        }),
      }),
    );
  });

  it("seeds featureOverrides from the plan flags so PlanFeatureGuard's warm-up fallback resolves (parity with register/social)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
      trialDays: 14,
      commissionRate: new Prisma.Decimal(0.15),
      posAccess: true,
      advancedReports: true,
      reservationSystem: true,
      apiAccess: false,
    } as any);

    await svc.provisionTenantForLead(command);

    const data = (prisma.tenant.create as any).mock.calls[0][0].data;
    expect(data.currentPlanId).toBe("plan-pro");
    // Without this seed a marketing-converted tenant had NO features until the
    // projector produced grants from currentPlan. posAccess is the v3.0.7-class
    // field — it MUST be present and reflect the plan.
    expect(data.featureOverrides).toEqual(
      expect.objectContaining({
        posAccess: true,
        advancedReports: true,
        reservationSystem: true,
        apiAccess: false, // a flag the plan does NOT grant stays false
      }),
    );
  });

  it("is idempotent: a prior ledger row returns the same tenant without writing", async () => {
    prisma.tenantProvisioningLog.findUnique.mockResolvedValue({
      leadId: "lead-1",
      tenantId: "tenant-1",
      adminUserId: "admin-1",
      subscriptionId: "sub-1",
    } as any);
    prisma.tenant.findUnique.mockResolvedValue({
      subdomain: "test-bistro",
    } as any);
    prisma.subscription.findUnique.mockResolvedValue({
      plan: {
        monthlyPrice: new Prisma.Decimal(1299),
        commissionRate: new Prisma.Decimal(0.15),
        name: "PRO",
      },
    } as any);

    const res = await svc.provisionTenantForLead(command);

    expect(res.created).toBe(false);
    expect(res.tenantId).toBe("tenant-1");
    expect(res.adminTempPassword).toBe(""); // password already delivered on first call
    expect(res.planFacts).toEqual({
      monthlyPrice: 1299,
      commissionRate: 0.15,
      planCode: "PRO",
    });
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("throws CoreProvisioningEmailInUseError when the admin email collides", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "existing" } as any);
    await expect(svc.provisionTenantForLead(command)).rejects.toBeInstanceOf(
      CoreProvisioningEmailInUseError,
    );
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it("throws CoreProvisioningPlanInvalidError for an inactive plan", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      isActive: false,
    } as any);
    await expect(svc.provisionTenantForLead(command)).rejects.toBeInstanceOf(
      CoreProvisioningPlanInvalidError,
    );
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  // deep-review H8 verification follow-up — the grant-before-pay bypass. The
  // amount-based guard (`subscriptionAmount > 0`) is defeated by a marketing
  // offer.customPrice of 0 (or negative) on a PAID, no-trial plan: it mints a
  // free ACTIVE paid subscription. The guard must key on the PLAN's real price.
  it("refuses a free ACTIVE paid sub via amountOverride=0 on a no-trial plan (H8 bypass)", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
      trialDays: 0, // no trial
      commissionRate: new Prisma.Decimal(0.15),
    } as any);

    await expect(
      svc.provisionTenantForLead({
        ...command,
        plan: { planId: "plan-pro", amountOverride: 0, trialDaysOverride: null },
      }),
    ).rejects.toBeInstanceOf(CoreProvisioningPlanInvalidError);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it("refuses a negative amountOverride on a paid plan", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
      trialDays: 14,
      commissionRate: new Prisma.Decimal(0.15),
    } as any);

    await expect(
      svc.provisionTenantForLead({
        ...command,
        plan: { planId: "plan-pro", amountOverride: -1, trialDaysOverride: null },
      }),
    ).rejects.toBeInstanceOf(CoreProvisioningPlanInvalidError);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  // deep-review H8 verification follow-up #2 — the RESIDUAL grant-before-pay
  // vector: an unbounded caller-supplied trialDaysOverride fakes a multi-year
  // free TRIALING subscription on a paid plan. A plan that offers NO trial
  // (trialDays=0) must not become trialable via the override.
  it("refuses a faked trial via trialDaysOverride on a no-trial paid plan", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
      trialDays: 0, // plan offers no trial
      commissionRate: new Prisma.Decimal(0.15),
    } as any);

    await expect(
      svc.provisionTenantForLead({
        ...command,
        plan: { planId: "plan-pro", amountOverride: null, trialDaysOverride: 3650 },
      }),
    ).rejects.toBeInstanceOf(CoreProvisioningPlanInvalidError);
    expect(prisma.subscription.create).not.toHaveBeenCalled();
  });

  // The override may shorten a trial but never extend it past the plan's own.
  it("clamps trialDaysOverride to the plan's server-owned trial length", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: "plan-pro",
      name: "PRO",
      isActive: true,
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
      trialDays: 14,
      commissionRate: new Prisma.Decimal(0.15),
    } as any);

    await svc.provisionTenantForLead({
      ...command,
      plan: { planId: "plan-pro", amountOverride: null, trialDaysOverride: 3650 },
    });

    const data = (prisma.subscription.create as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe("TRIALING");
    const span =
      (new Date(data.trialEnd).getTime() -
        new Date(data.currentPeriodStart).getTime()) /
      86_400_000;
    expect(Math.round(span)).toBe(14); // clamped to the plan's 14, not 3650
  });

  it("converges on the winner when a concurrent provision wins the ledger unique (P2002)", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError("unique violation", {
      code: "P2002",
      clientVersion: "test",
    } as any);
    (prisma.$transaction as any).mockRejectedValueOnce(p2002);
    prisma.tenantProvisioningLog.findUnique
      .mockResolvedValueOnce(null as any) // fast-path: not yet provisioned
      .mockResolvedValueOnce({
        leadId: "lead-1",
        tenantId: "tenant-9",
        adminUserId: "admin-9",
        subscriptionId: "sub-9",
      } as any); // re-read after the race
    // findUnique by subdomain (allocation) → free; by id (replay) → the tenant.
    prisma.tenant.findUnique.mockImplementation(
      (args: any) =>
        (args?.where?.id ? { subdomain: "test-bistro" } : null) as any,
    );
    prisma.subscription.findUnique.mockResolvedValue({
      plan: {
        monthlyPrice: new Prisma.Decimal(1299),
        commissionRate: new Prisma.Decimal(0.15),
        name: "PRO",
      },
    } as any);

    const res = await svc.provisionTenantForLead(command);

    expect(res.created).toBe(false);
    expect(res.tenantId).toBe("tenant-9"); // the winner's tenant, not a second one
  });

  it("no-plan conversion creates tenant + admin only, no subscription, no plan read", async () => {
    const res = await svc.provisionTenantForLead({ ...command, plan: null });

    expect(res.subscriptionId).toBeNull();
    expect(res.planFacts).toBeNull();
    expect(prisma.subscription.create).not.toHaveBeenCalled();
    expect(prisma.subscriptionPlan.findUnique).not.toHaveBeenCalled();
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
  });

  it("describePlan returns display facts for a known plan, null for unknown", async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValueOnce({
      name: "PRO",
      displayName: "Profesyonel",
      monthlyPrice: new Prisma.Decimal(1299),
      currency: "TRY",
    } as any);
    await expect(svc.describePlan("plan-pro")).resolves.toEqual({
      planCode: "PRO",
      planName: "Profesyonel",
      monthlyPrice: 1299,
      currency: "TRY",
    });

    prisma.subscriptionPlan.findUnique.mockResolvedValueOnce(null as any);
    await expect(svc.describePlan("nope")).resolves.toBeNull();
  });
});
