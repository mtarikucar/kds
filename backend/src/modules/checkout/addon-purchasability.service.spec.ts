import { ConflictException } from "@nestjs/common";
import { AddonPurchasabilityService } from "./addon-purchasability.service";
import { AddOnCatalogService } from "../marketplace/addon-catalog.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { EntitlementSet } from "../entitlements/entitlement.types";

/**
 * Pre-payment purchasability gate (Task 1 — money-integrity fix).
 *
 * TenantMarketplaceService.purchase() already checks included-in-plan,
 * active-duplicate, and deps — but only AFTER PayTR settles the charge
 * (inside confirmAndProvision). These tests pin the SAME checks running
 * standalone, BEFORE any payment is attempted, so CheckoutIntentService can
 * call assertPurchasable() and never mint an intent for a doomed purchase
 * (DEF-1/2/4/8).
 */
function ent(partial: Partial<EntitlementSet> = {}): EntitlementSet {
  return {
    features: {},
    limits: {},
    integrations: {},
    computedAt: new Date("2026-01-01").toISOString(),
    ...partial,
  } as EntitlementSet;
}

function addonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "addon-1",
    code: "advanced_reports",
    name: "Advanced reports",
    status: "published",
    grants: { "feature.advancedReports": true },
    deps: [] as string[],
    ...overrides,
  };
}

describe("AddonPurchasabilityService.assertPurchasable", () => {
  let prisma: MockPrismaClient;
  let catalog: jest.Mocked<AddOnCatalogService>;
  let entitlements: { getForTenant: jest.Mock };
  let svc: AddonPurchasabilityService;

  const TENANT = "t1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    catalog = { findByCodeOrThrow: jest.fn() } as any;
    entitlements = { getForTenant: jest.fn().mockResolvedValue(ent()) };
    svc = new AddonPurchasabilityService(
      prisma as any,
      catalog,
      entitlements as any,
    );
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue(null);
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
  });

  async function assertRejects(
    call: Promise<void>,
    code: string,
    addOnCode: string,
  ) {
    let threw = false;
    try {
      await call;
    } catch (e: any) {
      threw = true;
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(code);
      expect(e.getResponse().addOnCode).toBe(addOnCode);
    }
    expect(threw).toBe(true);
  }

  // ── Scenario 1: plan already includes the add-on's grants ────────────
  it("ADDON_INCLUDED_IN_PLAN — PRO tenant already has feature.advancedReports", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({ code: "advanced_reports", grants: { "feature.advancedReports": true } }),
    );
    entitlements.getForTenant.mockResolvedValue(
      ent({ features: { "feature.advancedReports": true } }),
    );

    await assertRejects(
      svc.assertPurchasable(TENANT, { addOnCode: "advanced_reports" }),
      "ADDON_INCLUDED_IN_PLAN",
      "advanced_reports",
    );
    // Must never even reach the ownership/deps DB checks — no point.
    expect(prisma.tenantAddOn.findFirst).not.toHaveBeenCalled();
  });

  // ── Scenario 2: tenant already actively owns it ───────────────────────
  it("ADDON_ALREADY_OWNED — active TenantAddOn already exists for this tenant/branch", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({ code: "advanced_reports", grants: { "feature.advancedReports": true } }),
    );
    entitlements.getForTenant.mockResolvedValue(ent()); // plan does NOT include it
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
      id: "ta-1",
      tenantId: TENANT,
      addOnId: "addon-1",
      branchId: null,
      status: "active",
    });

    await assertRejects(
      svc.assertPurchasable(TENANT, { addOnCode: "advanced_reports" }),
      "ADDON_ALREADY_OWNED",
      "advanced_reports",
    );
    expect(prisma.tenantAddOn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          addOnId: "addon-1",
          branchId: null,
          status: "active",
        }),
      }),
    );
  });

  // ── Scenario 3: deps tier semantics — "plan:X and above" ─────────────
  describe("ADDON_REQUIRES_PLAN — deps tier semantics", () => {
    function fiscalHuginRow() {
      return addonRow({
        code: "fiscal_hugin",
        name: "Hugin yazarkasa integration",
        grants: { "integration.fiscal": ["hugin"] },
        deps: ["plan:PRO"],
      });
    }

    it("BASIC tenant is rejected (below the plan:PRO dep)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(fiscalHuginRow());
      entitlements.getForTenant.mockResolvedValue(ent());
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        currentPlan: { name: "BASIC" },
      });

      await assertRejects(
        svc.assertPurchasable(TENANT, { addOnCode: "fiscal_hugin" }),
        "ADDON_REQUIRES_PLAN",
        "fiscal_hugin",
      );
    });

    it("BUSINESS tenant PASSES the same plan:PRO dep (tier 'and above' semantics)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(fiscalHuginRow());
      entitlements.getForTenant.mockResolvedValue(ent());
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        currentPlan: { name: "BUSINESS" },
      });

      await expect(
        svc.assertPurchasable(TENANT, { addOnCode: "fiscal_hugin" }),
      ).resolves.toBeUndefined();
    });

    it("PRO tenant also PASSES (exact tier match)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(fiscalHuginRow());
      entitlements.getForTenant.mockResolvedValue(ent());
      (prisma.tenant.findUnique as any).mockResolvedValue({
        id: TENANT,
        currentPlan: { name: "PRO" },
      });

      await expect(
        svc.assertPurchasable(TENANT, { addOnCode: "fiscal_hugin" }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Scenario 4: redundant capacity add-on ─────────────────────────────
  it("ADDON_LIMIT_REDUNDANT — BUSINESS tenant (maxBranches=-1) buys extra_branch", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({
        code: "extra_branch",
        name: "Extra branch",
        grants: { "limit.branches": 1, "feature.multiLocation": true },
        deps: [],
      }),
    );
    entitlements.getForTenant.mockResolvedValue(
      ent({
        features: { "feature.multiLocation": true },
        limits: { "limit.maxBranches": -1 },
      }),
    );

    await assertRejects(
      svc.assertPurchasable(TENANT, { addOnCode: "extra_branch" }),
      "ADDON_LIMIT_REDUNDANT",
      "extra_branch",
    );
  });

  it("does NOT flag extra_branch as redundant when maxBranches is still finite", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({
        code: "extra_branch",
        name: "Extra branch",
        grants: { "limit.branches": 1, "feature.multiLocation": true },
        deps: [],
      }),
    );
    entitlements.getForTenant.mockResolvedValue(
      ent({ limits: { "limit.maxBranches": 3 } }),
    );

    await expect(
      svc.assertPurchasable(TENANT, { addOnCode: "extra_branch" }),
    ).resolves.toBeUndefined();
  });

  it("passes branchId through to the ownership + limit checks", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({ code: "advanced_reports" }),
    );
    entitlements.getForTenant.mockResolvedValue(ent());

    await svc.assertPurchasable(TENANT, {
      addOnCode: "advanced_reports",
      branchId: "branch-9",
    });

    expect(prisma.tenantAddOn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ branchId: "branch-9" }),
      }),
    );
  });
});
