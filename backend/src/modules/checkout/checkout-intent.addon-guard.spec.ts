import { ConflictException } from "@nestjs/common";
import { CheckoutIntentService } from "./checkout-intent.service";
import { AddonPurchasabilityService } from "./addon-purchasability.service";
import { AddOnCatalogService } from "../marketplace/addon-catalog.service";
import { Cart, CartQuote } from "./checkout.types";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { EntitlementSet } from "../entitlements/entitlement.types";

/**
 * Task 1 — exploit tests for the tahsilat-önü (pre-payment) add-on guard.
 *
 * DEFECT (pre-fix): TenantMarketplaceService.purchase() already checks
 * included-in-plan / already-owned / deps, but only AFTER PayTR settles the
 * charge (confirmAndProvision). A tenant could pay full price for an
 * add-on their plan already includes, one they already own, or one whose
 * deps they don't meet — purchase() then rejects the grant and there is no
 * refund rail (DEF-1/2/4/8).
 *
 * These tests wire the REAL AddonPurchasabilityService (with mocked
 * prisma/catalog/entitlements) into a REAL CheckoutIntentService and assert
 * the exploit is closed end-to-end at the createIntent boundary: for every
 * rejected scenario, `prisma.checkoutIntent.create` and
 * `payments.createIntent` must NEVER be called — no row, no gateway call,
 * no money in flight.
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

describe("CheckoutIntentService.createIntent — add-on purchasability guard (Task 1)", () => {
  let prisma: MockPrismaClient;
  let payments: any;
  let quoteSvc: any;
  let catalog: jest.Mocked<AddOnCatalogService>;
  let entitlements: { getForTenant: jest.Mock };
  let addonGuard: AddonPurchasabilityService;
  // Task 4 — hardware CatalogService (distinct from the add-on `catalog`
  // above). None of this file's fixtures carry a `hardware` cart line, so
  // the stock-check loop is a no-op here; dedicated coverage lives in
  // checkout-intent.hardware-stock.spec.ts. Still wired so the constructor
  // shape matches production DI.
  let hardwareCatalog: any;
  let svc: CheckoutIntentService;

  const buyer = {
    email: "buyer@example.com",
    name: "Test Buyer",
    phone: "+905551234567",
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue(null);
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);

    payments = { createIntent: jest.fn() };
    quoteSvc = { quote: jest.fn() };
    catalog = { findByCodeOrThrow: jest.fn() } as any;
    entitlements = { getForTenant: jest.fn().mockResolvedValue(ent()) };
    hardwareCatalog = { getAvailableStock: jest.fn().mockResolvedValue(999) };

    addonGuard = new AddonPurchasabilityService(
      prisma as any,
      catalog,
      entitlements as any,
    );
    svc = new CheckoutIntentService(
      prisma as any,
      quoteSvc,
      payments,
      addonGuard,
      hardwareCatalog,
    );
  });

  function addonCart(code: string, branchId?: string): Cart {
    return { items: [{ type: "addon", code, branchId }] };
  }

  function validQuote(): CartQuote {
    return {
      lines: [
        {
          type: "addon",
          code: "whatever",
          name: "Whatever",
          qty: 1,
          unitCents: 9900,
          subtotalCents: 9900,
          cadence: "monthly",
          meta: {},
        },
      ],
      currency: "TRY",
      subtotalCents: 8250,
      taxCents: 1650,
      shippingCents: 0,
      totalCents: 9900,
      warnings: [],
      isPureRecurring: true,
    };
  }

  async function expectRejected(code: string, addOnCode: string) {
    let threw = false;
    try {
      await svc.createIntent({
        tenantId: "t-1",
        cart: addonCart(addOnCode),
        buyer,
        buyerIp: "1.2.3.4",
      });
    } catch (e: any) {
      threw = true;
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(code);
      expect(e.getResponse().addOnCode).toBe(addOnCode);
    }
    expect(threw).toBe(true);
    // The money-integrity assertion: NOTHING downstream ran.
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
    expect(quoteSvc.quote).not.toHaveBeenCalled();
  }

  it("1) ADDON_INCLUDED_IN_PLAN — PRO tenant (advancedReports included) adds advanced_reports", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({ code: "advanced_reports", grants: { "feature.advancedReports": true } }),
    );
    entitlements.getForTenant.mockResolvedValue(
      ent({ features: { "feature.advancedReports": true } }),
    );

    await expectRejected("ADDON_INCLUDED_IN_PLAN", "advanced_reports");
  });

  it("2) ADDON_ALREADY_OWNED — tenant already has an active advanced_reports TenantAddOn", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({ code: "advanced_reports", grants: { "feature.advancedReports": true } }),
    );
    entitlements.getForTenant.mockResolvedValue(ent());
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
      id: "ta-1",
      tenantId: "t-1",
      addOnId: "addon-1",
      branchId: null,
      status: "active",
    });

    await expectRejected("ADDON_ALREADY_OWNED", "advanced_reports");
  });

  it("3a) ADDON_REQUIRES_PLAN — BASIC tenant adds fiscal_hugin (deps plan:PRO)", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({
        code: "fiscal_hugin",
        name: "Hugin yazarkasa integration",
        grants: { "integration.fiscal": ["hugin"] },
        deps: ["plan:PRO"],
      }),
    );
    entitlements.getForTenant.mockResolvedValue(ent());
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: "t-1",
      currentPlan: { name: "BASIC" },
    });

    await expectRejected("ADDON_REQUIRES_PLAN", "fiscal_hugin");
  });

  it("3b) BUSINESS tenant PASSES the same fiscal_hugin plan:PRO dep (tier 'and above') and reaches PayTR", async () => {
    catalog.findByCodeOrThrow.mockResolvedValue(
      addonRow({
        code: "fiscal_hugin",
        name: "Hugin yazarkasa integration",
        grants: { "integration.fiscal": ["hugin"] },
        deps: ["plan:PRO"],
      }),
    );
    entitlements.getForTenant.mockResolvedValue(ent());
    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: "t-1",
      currentPlan: { name: "BUSINESS" },
    });
    quoteSvc.quote.mockResolvedValue(validQuote());
    payments.createIntent.mockResolvedValue({
      providerId: "paytr",
      intentId: "CK-xxx",
      status: "pending",
      amountCents: 9900,
      currency: "TRY",
      clientAction: { iframeToken: "tok", paymentLink: "https://pay.test/x" },
    });

    await expect(
      svc.createIntent({
        tenantId: "t-1",
        cart: addonCart("fiscal_hugin"),
        buyer,
        buyerIp: "1.2.3.4",
      }),
    ).resolves.toBeDefined();

    expect(prisma.checkoutIntent.create).toHaveBeenCalledTimes(1);
    expect(payments.createIntent).toHaveBeenCalledTimes(1);
  });

  it("4) ADDON_LIMIT_REDUNDANT — BUSINESS tenant (maxBranches=-1) adds extra_branch", async () => {
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

    await expectRejected("ADDON_LIMIT_REDUNDANT", "extra_branch");
  });

  it("checks EVERY addon line in a multi-line cart — first rejection wins, still nothing downstream", async () => {
    catalog.findByCodeOrThrow.mockImplementation(async (code: string) => {
      if (code === "advanced_reports") {
        return addonRow({
          code: "advanced_reports",
          grants: { "feature.advancedReports": true },
        }) as any;
      }
      return addonRow({ code, grants: {} }) as any;
    });
    entitlements.getForTenant.mockResolvedValue(
      ent({ features: { "feature.advancedReports": true } }),
    );

    let threw = false;
    try {
      await svc.createIntent({
        tenantId: "t-1",
        cart: {
          items: [
            { type: "addon", code: "priority_support" },
            { type: "addon", code: "advanced_reports" }, // included -> rejects
          ],
        },
        buyer,
        buyerIp: "1.2.3.4",
      });
    } catch (e: any) {
      threw = true;
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe("ADDON_INCLUDED_IN_PLAN");
    }
    expect(threw).toBe(true);
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });
});
