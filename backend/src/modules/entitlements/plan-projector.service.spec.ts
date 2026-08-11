import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { PlanProjectorService } from "./plan-projector.service";
import {
  FREE_BASELINE_GRANTS,
  FREE_BASELINE_SOURCE,
} from "./free-baseline.const";
import { ADDON_GRACE_DAYS } from "../marketplace/marketplace.types";

/**
 * The projector is the only writer of `feature_entitlements`, so everything
 * the guards allow is decided here.
 *
 * v3.3.0 replaced "read the tenant's plan columns, or the FREE plan's columns
 * if the subscription lapsed" with three sources: a constant free baseline,
 * the tenant's owned products, and admin overrides. The snapshot test below
 * used to pin the plan column list and is now the drift tripwire for the
 * BASELINE — the thing that decides what every tenant gets for nothing.
 */
describe("PlanProjectorService.projectTenant", () => {
  let prisma: MockPrismaClient;
  let entitlements: {
    setGrantsForSourceTx: jest.Mock;
    invalidate: jest.Mock;
  };
  let svc: PlanProjectorService;

  const TENANT = "t-1";

  /** Grants written for one source during the last projection. */
  const grantsFor = (source: string) =>
    entitlements.setGrantsForSourceTx.mock.calls.find(
      (c) => c[2] === source,
    )?.[3] ?? null;

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = {
      setGrantsForSourceTx: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
    };
    svc = new PlanProjectorService(prisma as any, entitlements as any);
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
    });
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({ count: 0 });
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  });

  describe("free baseline", () => {
    it("SNAPSHOT: the free core is exactly this — everything else is paid", () => {
      // DRIFT TRIPWIRE. This list is the product's free tier. Adding a key
      // here gives it away to every tenant forever; removing one takes it
      // from tenants who have it today. Neither should happen by accident,
      // and neither is visible in a diff of the projector.
      expect(FREE_BASELINE_GRANTS).toEqual({
        "feature.posAccess": true,
        "feature.kdsIntegration": true,
        "feature.customBranding": true,
        // The branch HUB is free; the second branch is the paid part.
        "feature.multiLocation": true,
        "limit.maxUsers": -1,
        "limit.maxTables": -1,
        "limit.maxProducts": -1,
        "limit.maxCategories": -1,
        "limit.maxMonthlyOrders": -1,
        "limit.maxBranches": 1,
      });
    });

    it("projects the baseline for a tenant who has bought nothing", async () => {
      await svc.projectTenant(TENANT);

      const grants = grantsFor(FREE_BASELINE_SOURCE);
      expect(grants).toHaveLength(Object.keys(FREE_BASELINE_GRANTS).length);
      expect(grants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: "feature.posAccess", value: true }),
          expect.objectContaining({ key: "limit.maxTables", value: -1 }),
          expect.objectContaining({ key: "limit.maxBranches", value: 1 }),
        ]),
      );
    });

    it("never grants a PAID feature from the baseline", async () => {
      await svc.projectTenant(TENANT);
      const keys = (grantsFor(FREE_BASELINE_SOURCE) ?? []).map(
        (g: any) => g.key,
      );
      for (const paid of [
        "feature.license",
        "feature.advancedReports",
        "feature.inventoryTracking",
        "feature.reservationSystem",
        "feature.personnelManagement",
        "feature.aiContentGeneration",
        "feature.apiAccess",
        "feature.externalDisplay",
        "feature.prioritySupport",
        "feature.deliveryIntegration",
      ]) {
        expect(keys).not.toContain(paid);
      }
    });

    it("sweeps EVERY plan-sourced row — plans are retired", async () => {
      await svc.projectTenant(TENANT);
      expect(prisma.featureEntitlement.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, source: { startsWith: "plan:" } },
      });
    });

    it("never reads a subscription or a plan row", async () => {
      // The whole point: entitlements no longer depend on billing state.
      await svc.projectTenant(TENANT);
      expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
      expect(prisma.subscriptionPlan.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("licence suppression", () => {
    const future = new Date(Date.now() + 90 * 86_400_000);

    const addon = (over: Record<string, unknown> = {}) => ({
      id: "ta-1",
      branchId: null,
      quantity: 1,
      status: "active",
      currentPeriodEnd: future,
      addOn: {
        code: "advanced_reports",
        kind: "module",
        requiresLicense: true,
        grants: { "feature.advancedReports": true },
      },
      ...over,
    });

    const licence = (over: Record<string, unknown> = {}) => ({
      id: "ta-lic",
      branchId: null,
      quantity: 1,
      status: "active",
      currentPeriodEnd: future,
      addOn: {
        code: "license_annual",
        kind: "license",
        requiresLicense: false,
        grants: { "feature.license": true },
      },
      ...over,
    });

    it("grants an owned module when the licence is live", async () => {
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        licence(),
        addon(),
      ]);
      await svc.projectTenant(TENANT);

      expect(grantsFor("addon:advanced_reports:ta-1")).toEqual([
        expect.objectContaining({ key: "feature.advancedReports", value: true }),
      ]);
    });

    it("SUPPRESSES the module's grants when the licence is absent", async () => {
      // Access goes dark; the ownership row and everything it paid for stay
      // exactly where they are. Paying the licence re-lights it.
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([addon()]);
      await svc.projectTenant(TENANT);

      expect(grantsFor("addon:advanced_reports:ta-1")).toEqual([]);
      // The SOURCE is still visited, so the owned-items list stays whole —
      // the tenant keeps the product, they just cannot use it.
      const sources = entitlements.setGrantsForSourceTx.mock.calls.map(
        (c) => c[2],
      );
      expect(sources).toContain("addon:advanced_reports:ta-1");
    });

    it("does not suppress a product that declares requiresLicense=false", async () => {
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        addon({
          id: "ta-2",
          addOn: {
            code: "onsite_install_full",
            kind: "service",
            requiresLicense: false,
            grants: { "feature.prioritySupport": true },
          },
        }),
      ]);
      await svc.projectTenant(TENANT);
      expect(grantsFor("addon:onsite_install_full:ta-2")).toHaveLength(1);
    });

    it("treats an EXPIRED licence period as dark", async () => {
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        licence({ currentPeriodEnd: new Date(Date.now() - 86_400_000) }),
        addon(),
      ]);
      await svc.projectTenant(TENANT);
      expect(grantsFor("addon:advanced_reports:ta-1")).toEqual([]);
    });

    it("keeps a past_due licence alive through its grace window", async () => {
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        licence({
          status: "past_due",
          currentPeriodEnd: new Date(Date.now() - 2 * 86_400_000),
        }),
        addon(),
      ]);
      await svc.projectTenant(TENANT);
      expect(grantsFor("addon:advanced_reports:ta-1")).toHaveLength(1);
    });
  });

  describe("grace horizon", () => {
    it("gives ACTIVE rows the same grace as past_due ones", async () => {
      // v3.3.0 fix for an annual, hours-long blackout: the engine's validUntil
      // sweep runs every 5 minutes while the add-on sweeper runs on a daily
      // cron, so an active grant that expired exactly at currentPeriodEnd went
      // dark at midnight and stayed dark until the sweeper woke up — for every
      // paying tenant, every anniversary. The sweeper, not the clock, must be
      // what ends access.
      const periodEnd = new Date("2027-03-10T00:00:00.000Z");
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        {
          id: "ta-lic",
          branchId: null,
          quantity: 1,
          status: "active",
          currentPeriodEnd: periodEnd,
          addOn: {
            code: "license_annual",
            kind: "license",
            requiresLicense: false,
            grants: { "feature.license": true },
          },
        },
      ]);
      await svc.projectTenant(TENANT);

      const grant = grantsFor("addon:license_annual:ta-lic")[0];
      expect(grant.validUntil).toEqual(
        new Date(periodEnd.getTime() + ADDON_GRACE_DAYS * 86_400_000),
      );
    });
  });

  describe("credits", () => {
    it("never projects a credit.* grant into the entitlement set", async () => {
      // Balances are read live inside the advisory-locked claim; a 30s-cached
      // number in front of a real vendor charge is a money bug.
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        {
          id: "ta-c",
          branchId: null,
          quantity: 1,
          status: "active",
          currentPeriodEnd: null,
          addOn: {
            code: "credit_ai_photo_100",
            kind: "credit",
            requiresLicense: false,
            grants: { "credit.PHOTO": 100 },
          },
        },
      ]);
      await svc.projectTenant(TENANT);
      expect(grantsFor("addon:credit_ai_photo_100:ta-c")).toEqual([]);
    });
  });

  describe("admin overrides", () => {
    it("projects a GRANT override as a plain true that composes", async () => {
      // The poison-pill fix. A plain `true` OR-folds with everything else, so
      // it can never block a product the tenant later pays for. Pre-3.3 every
      // override — including grants — went through __replace, which is applied
      // AFTER the additive pass.
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        featureOverrides: { advancedReports: { mode: "grant" } },
        limitOverrides: null,
      });
      await svc.projectTenant(TENANT);

      expect(grantsFor("override:admin")).toEqual([
        expect.objectContaining({
          key: "feature.advancedReports",
          value: true,
        }),
      ]);
    });

    it("projects a SUPPRESS override as the __replace form", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        featureOverrides: { advancedReports: { mode: "suppress" } },
        limitOverrides: null,
      });
      await svc.projectTenant(TENANT);

      expect(grantsFor("override:admin")).toEqual([
        expect.objectContaining({
          key: "feature.advancedReports",
          value: { __replace: false },
        }),
      ]);
    });

    it("reads a legacy boolean override with the same semantics", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        featureOverrides: { advancedReports: true, apiAccess: false },
        limitOverrides: null,
      });
      await svc.projectTenant(TENANT);

      const grants = grantsFor("override:admin");
      expect(grants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: "feature.advancedReports",
            value: true,
          }),
          expect.objectContaining({
            key: "feature.apiAccess",
            value: { __replace: false },
          }),
        ]),
      );
    });

    it("still projects limit overrides as a hard replace", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        featureOverrides: null,
        limitOverrides: { maxBranches: 25 },
      });
      await svc.projectTenant(TENANT);

      expect(grantsFor("override:admin")).toEqual([
        expect.objectContaining({
          key: "limit.maxBranches",
          value: { __replace: 25 },
        }),
      ]);
    });
  });

  it("invalidates the cache exactly once, after the whole projection", async () => {
    await svc.projectTenant(TENANT);
    expect(entitlements.invalidate).toHaveBeenCalledTimes(1);
    expect(entitlements.invalidate).toHaveBeenCalledWith(TENANT);
  });
});
