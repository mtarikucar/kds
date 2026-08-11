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
/**
 * Baseline entitlement set for a LICENSED tenant.
 *
 * Every rule in this file other than the licence prerequisite itself assumes
 * the tenant is licensed — an unlicensed tenant is rejected before any of them
 * is reached, which is the point of the prerequisite. `unlicensed()` is the
 * explicit opt-out for the tests that are about that rule.
 */
function ent(partial: Partial<EntitlementSet> = {}): EntitlementSet {
  return {
    limits: {},
    integrations: {},
    computedAt: new Date("2026-01-01").toISOString(),
    ...partial,
    features: { "feature.license": true, ...(partial.features ?? {}) },
  } as EntitlementSet;
}

function unlicensed(partial: Partial<EntitlementSet> = {}): EntitlementSet {
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
    kind: "module",
    billing: "annual",
    priceCents: 129_000,
    // v3.3.0 — everything paid is licence-gated by default; the fixtures that
    // exercise the non-licence rules grant the licence in the entitlement set.
    requiresLicense: true,
    maxQuantity: null,
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
    // Baseline: a LICENSED tenant, so the scenarios below exercise the rule
    // they are actually about rather than tripping the licence prerequisite.
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

  // ── Scenario 1: the tenant's entitlements already cover the grants ────
  it("ADDON_ALREADY_GRANTED — the feature is already active on the account", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({ code: "advanced_reports", grants: { "feature.advancedReports": true } }),
    );
    entitlements.getForTenant.mockResolvedValue(
      ent({ features: { "feature.advancedReports": true } }),
    );

    await assertRejects(
      svc.assertPurchasable(TENANT, { addOnCode: "advanced_reports" }),
      "ADDON_ALREADY_GRANTED",
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

  // ── Scenario 3: the LICENCE prerequisite ─────────────────────────────
  //
  // Plans are retired, so "plan:PRO and above" deps are gone. What replaced
  // them is a single, sharper rule: every `requiresLicense` product needs a
  // live licence, because the projector SUPPRESSES the grants of every such
  // product while the licence is dark. Selling one to an unlicensed tenant
  // would take money for access they cannot exercise.
  describe("LICENSE_REQUIRED", () => {
    it("rejects a licence-gated product when the tenant has no licence", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(addonRow());
      entitlements.getForTenant.mockResolvedValue(unlicensed());

      await assertRejects(
        svc.assertPurchasable(TENANT, { addOnCode: "advanced_reports" }),
        "LICENSE_REQUIRED",
        "advanced_reports",
      );
    });

    it("ACCEPTS it when the licence is a sibling line in the same cart", async () => {
      // The opening cart a first-time buyer must be able to submit: the
      // licence and the first module it unlocks, together. Without cart
      // awareness this is unbuyable.
      catalog.findByCodeOrThrow.mockResolvedValue(addonRow());
      entitlements.getForTenant.mockResolvedValue(unlicensed());

      await expect(
        svc.assertPurchasable(
          TENANT,
          { addOnCode: "advanced_reports" },
          { cartCodes: new Set(["license_annual"]) },
        ),
      ).resolves.toBeUndefined();
    });

    it("does not gate a product that declares requiresLicense=false", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        addonRow({
          code: "onsite_install_full",
          kind: "service",
          billing: "oneTime",
          requiresLicense: false,
          grants: {},
        }),
      );
      entitlements.getForTenant.mockResolvedValue(unlicensed());

      await expect(
        svc.assertPurchasable(TENANT, { addOnCode: "onsite_install_full" }),
      ).resolves.toBeUndefined();
    });

    it("refuses a SECOND licence — renewal goes through the renewal cycle", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        addonRow({
          code: "license_annual",
          kind: "license",
          requiresLicense: false,
          grants: { "feature.license": true },
        }),
      );
      entitlements.getForTenant.mockResolvedValue(ent());

      await assertRejects(
        svc.assertPurchasable(TENANT, { addOnCode: "license_annual" }),
        "ADDON_ALREADY_OWNED",
        "license_annual",
      );
    });
  });

  // ── Scenario 3b: product dependencies are bare catalog codes ──────────
  describe("ADDON_REQUIRES_DEPENDENCY", () => {
    function creditPackRow() {
      return addonRow({
        code: "credit_ai_photo_100",
        name: "100 AI image credits",
        kind: "credit",
        billing: "oneTime",
        requiresLicense: false,
        grants: {},
        deps: ["module_ai_studio"],
      });
    }

    it("rejects a credit pack when the module that spends it is not owned", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(creditPackRow());
      (prisma.tenant.findUnique as any).mockResolvedValue({ id: TENANT });
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
      (prisma.marketplaceAddOn.findUnique as any).mockResolvedValue({
        name: "AI Menu Studio",
      });

      await assertRejects(
        svc.assertPurchasable(TENANT, { addOnCode: "credit_ai_photo_100" }),
        "ADDON_REQUIRES_DEPENDENCY",
        "credit_ai_photo_100",
      );
    });

    it("accepts it when the module is already an active ownership row", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(creditPackRow());
      (prisma.tenant.findUnique as any).mockResolvedValue({ id: TENANT });
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        { addOn: { code: "module_ai_studio", name: "AI Menu Studio" } },
      ]);

      await expect(
        svc.assertPurchasable(TENANT, { addOnCode: "credit_ai_photo_100" }),
      ).resolves.toBeUndefined();
    });

    it("accepts it when the module is a sibling line in the same cart", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(creditPackRow());
      (prisma.tenant.findUnique as any).mockResolvedValue({ id: TENANT });
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);

      await expect(
        svc.assertPurchasable(
          TENANT,
          { addOnCode: "credit_ai_photo_100" },
          { cartCodes: new Set(["module_ai_studio", "license_annual"]) },
        ),
      ).resolves.toBeUndefined();
    });

    it("buying a SECOND credit pack is always allowed (credits are consumable)", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(creditPackRow());
      (prisma.tenant.findUnique as any).mockResolvedValue({ id: TENANT });
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        { addOn: { code: "module_ai_studio", name: "AI Menu Studio" } },
      ]);
      // An existing "ownership" row must not block a repeat purchase.
      (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
        id: "ta-1",
        quantity: 1,
      });

      await expect(
        svc.assertPurchasable(TENANT, { addOnCode: "credit_ai_photo_100" }),
      ).resolves.toBeUndefined();
    });
  });

  // ── Scenario 3c: capacity is quantity-based ───────────────────────────
  describe("capacity quantity", () => {
    function branchRow(maxQuantity: number | null = 100) {
      return addonRow({
        code: "extra_branch",
        name: "Extra branch",
        kind: "capacity",
        maxQuantity,
        grants: { "limit.maxBranches": 1 },
      });
    }

    it("allows buying another unit when one is already owned", async () => {
      // Pre-3.3 this threw "already active — change quantity instead" and
      // pointed at a path that did not exist, so capacity was unsellable past
      // a single unit.
      catalog.findByCodeOrThrow.mockResolvedValue(branchRow());
      (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
        id: "ta-1",
        quantity: 2,
      });

      await expect(
        svc.assertPurchasable(TENANT, { addOnCode: "extra_branch", quantity: 1 }),
      ).resolves.toBeUndefined();
    });

    it("enforces the catalog ceiling", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(branchRow(3));
      (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
        id: "ta-1",
        quantity: 3,
      });

      await assertRejects(
        svc.assertPurchasable(TENANT, { addOnCode: "extra_branch", quantity: 1 }),
        "ADDON_MAX_QUANTITY",
        "extra_branch",
      );
    });
  });

  // ── Scenario 4: redundant capacity add-on ─────────────────────────────
  it("ADDON_LIMIT_REDUNDANT — BUSINESS tenant (maxBranches=-1) buys extra_branch", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({
        code: "extra_branch",
        name: "Extra branch",
        // Task 5 fixed the seed grant key from `limit.branches` to
        // `limit.maxBranches` (the key the engine actually reads) — this
        // mock mirrors the corrected catalog row; no REDUNDANCY_KEY_MAP
        // remapping needed anymore.
        grants: { "limit.maxBranches": 1, "feature.multiLocation": true },
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
        grants: { "limit.maxBranches": 1, "feature.multiLocation": true },
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
