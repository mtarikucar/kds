import { ADDONS } from "../../../prisma/seeds/seed-marketplace";
import { PlanProjectorService } from "./plan-projector.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";

/**
 * Regression test for DEF-6 (Task 5): the `extra_branch` add-on's catalog
 * grant must use the SAME key every entitlement consumer reads —
 * `limit.maxBranches` (PlanProjectorService.LIMIT_COLUMNS,
 * check-limit.decorator's `LimitType.BRANCHES = "maxBranches"`,
 * PlanFeatureGuard.checkLimit's `engineSet.limits[\`limit.${limitType}\`]`
 * lookup). The pre-fix seed wrote `limit.branches` instead — the projector
 * faithfully summed it into the engine under a key NOTHING reads, so a
 * tenant paying ₺399/mo for extra_branch never actually saw their branch
 * cap rise.
 *
 * Deliberately imports the REAL `ADDONS` catalog array from the seed file
 * (not a hand-rolled fixture, unlike plan-projector.service.spec.ts's Wave
 * D tests) so this test fails the instant the seed regresses to the wrong
 * key — a hand-rolled fixture with the "correct" key baked in would never
 * catch that.
 */
describe("extra_branch grant key (DEF-6 regression)", () => {
  const TENANT = "tenant-extra-branch";
  let prisma: MockPrismaClient;
  let entitlements: any;
  let svc: PlanProjectorService;

  const extraBranchCatalogRow = ADDONS.find((a) => a.code === "extra_branch");

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = {
      setGrantsForSourceTx: jest.fn().mockResolvedValue(undefined),
      invalidate: jest.fn(),
    } as any;
    svc = new PlanProjectorService(prisma as any, entitlements);
    (prisma.featureEntitlement.deleteMany as any).mockResolvedValue({
      count: 0,
    });
    (prisma.$transaction as any).mockImplementation(async (fn: any) =>
      fn(prisma),
    );
    prisma.tenant.findUnique.mockResolvedValue({
      id: TENANT,
      featureOverrides: null,
      limitOverrides: null,
      currentPlan: { id: "p", name: "BASIC", maxBranches: 1 },
    } as any);
    (prisma.subscription.findFirst as any).mockResolvedValue({
      id: "sub-1",
      status: "ACTIVE",
    });
  });

  it("catalog fixture sanity: extra_branch grants exactly limit.maxBranches (never limit.branches)", () => {
    expect(extraBranchCatalogRow).toBeDefined();
    const grantKeys = Object.keys(
      (extraBranchCatalogRow!.grants as Record<string, unknown>) ?? {},
    );
    const limitKeys = grantKeys.filter((k) => k.startsWith("limit."));
    expect(limitKeys).toEqual(["limit.maxBranches"]);
  });

  it("projecting a tenant's active extra_branch TenantAddOn raises effective limit.maxBranches", async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      {
        id: "ta-branch-1",
        tenantId: TENANT,
        branchId: null,
        quantity: 1,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        addOn: extraBranchCatalogRow,
      },
    ]);

    await svc.projectTenant(TENANT);

    const addOnCall = entitlements.setGrantsForSourceTx.mock.calls.find(
      (c: any[]) => String(c[2]).startsWith("addon:extra_branch:"),
    );
    expect(addOnCall).toBeDefined();
    const grants = addOnCall[3];

    // THE regression: pre-fix this key is `limit.branches`, which nothing
    // in the guard stack (PlanFeatureGuard.checkLimit, check-limit
    // decorator, LIMIT_COLUMNS) reads — the cap never rises.
    const branchGrant = grants.find(
      (g: any) => g.key === "limit.maxBranches",
    );
    expect(branchGrant).toBeDefined();
    expect(branchGrant.value).toBe(1);

    // The dead key must never be projected (again).
    expect(grants.some((g: any) => g.key === "limit.branches")).toBe(false);

    // feature.multiLocation must survive the key fix untouched.
    const featureGrant = grants.find(
      (g: any) => g.key === "feature.multiLocation",
    );
    expect(featureGrant?.value).toBe(true);
  });
});
