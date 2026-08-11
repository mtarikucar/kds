import { BadRequestException, ForbiddenException } from "@nestjs/common";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { TenantMarketplaceService } from "./tenant-marketplace.service";

/**
 * À-la-carte provisioning rules (v3.3.0).
 *
 * Each of these closes a hole that was real in the pre-3.3 code:
 *   - annual products were given a rolling 30-day period, so a ₺2.990/yr
 *     licence would have expired in a month;
 *   - a second capacity unit threw "change quantity instead", pointing at a
 *     path that did not exist — capacity was unsellable past one unit;
 *   - there was no operator comp path at all, so ops reached for
 *     `featureOverrides`, which projects `{__replace:false}` and permanently
 *     suppresses a product the tenant later PAYS for;
 *   - credit packs would have become renewing ownership rows granting nothing.
 */
const ANCHOR = new Date("2026-03-10T00:00:00.000Z");
const PERIOD_END = new Date("2027-03-10T00:00:00.000Z");

function catalogRow(over: Record<string, unknown> = {}) {
  return {
    id: "addon-1",
    code: "advanced_reports",
    name: "Advanced reports",
    status: "published",
    kind: "module",
    billing: "annual",
    priceCents: 129_000,
    currency: "TRY",
    grants: { "feature.advancedReports": true },
    deps: [] as string[],
    requiresLicense: true,
    creditKind: null,
    creditUnits: null,
    maxQuantity: null,
    ...over,
  };
}

describe("TenantMarketplaceService — à-la-carte provisioning", () => {
  let prisma: MockPrismaClient;
  let catalog: { findByCodeOrThrow: jest.Mock };
  let outbox: { append: jest.Mock };
  let licensing: any;
  let svc: TenantMarketplaceService;

  const TENANT = "t-1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    catalog = { findByCodeOrThrow: jest.fn() };
    outbox = { append: jest.fn().mockResolvedValue("evt-1") };
    licensing = {
      loadContext: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        anchorAt: ANCHOR,
        hasLicense: true,
        now: new Date("2026-03-20T00:00:00.000Z"),
        tz: "Europe/Istanbul",
      }),
      price: jest.fn().mockReturnValue({
        mode: "prorated",
        unitCents: 125_466,
        subtotalCents: 125_466,
        remainingDays: 355,
        billedDays: 355,
        cycleDays: 365,
        periodStart: new Date("2026-03-20T00:00:00.000Z"),
        periodEnd: PERIOD_END,
        anchorAt: ANCHOR,
      }),
      resolveAnchorFor: jest.fn().mockReturnValue(ANCHOR),
      stampAnchorIfAbsent: jest.fn().mockResolvedValue(undefined),
    };
    svc = new TenantMarketplaceService(
      prisma as any,
      catalog as any,
      outbox as any,
      { getForTenant: jest.fn() } as any,
      licensing as any,
    );
    (prisma.tenantAddOn.findFirst as any).mockResolvedValue(null);
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    (prisma.tenantAddOn.create as any).mockImplementation(
      async ({ data }: any) => ({ id: "ta-new", ...data }),
    );
    (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
  });

  describe("annual periods", () => {
    it("provisions the ANNIVERSARY period the line was priced for", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(catalogRow());

      await svc.purchase(
        TENANT,
        {
          addOnCode: "advanced_reports",
          paymentRef: "CK-1",
          chargedCents: 125_466,
          periodStart: new Date("2026-03-20T00:00:00.000Z"),
          periodEnd: PERIOD_END,
        },
        prisma as any,
      );

      const data = (prisma.tenantAddOn.create as any).mock.calls[0][0].data;
      // NOT now+30d — the charged proration and the provisioned period must
      // never disagree.
      expect(data.currentPeriodEnd).toEqual(PERIOD_END);
      expect(data.chargedCents).toBe(125_466);
      expect(data.origin).toBe("purchase");
    });

    it("resolves the period itself when a direct caller supplies none", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(catalogRow({ priceCents: 0 }));

      await svc.purchase(TENANT, { addOnCode: "advanced_reports" }, prisma as any);

      const data = (prisma.tenantAddOn.create as any).mock.calls[0][0].data;
      expect(data.currentPeriodEnd).toEqual(PERIOD_END);
    });

    it("stamps the anniversary anchor when the licence itself is provisioned", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({
          code: "license_annual",
          kind: "license",
          requiresLicense: false,
          grants: { "feature.license": true },
        }),
      );

      await svc.purchase(
        TENANT,
        { addOnCode: "license_annual", paymentRef: "CK-1", periodEnd: PERIOD_END },
        prisma as any,
      );

      expect(licensing.stampAnchorIfAbsent).toHaveBeenCalledWith(
        prisma,
        TENANT,
        ANCHOR,
      );
    });

    it("does NOT stamp an anchor for an ordinary module", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(catalogRow());
      await svc.purchase(
        TENANT,
        { addOnCode: "advanced_reports", paymentRef: "CK-1", periodEnd: PERIOD_END },
        prisma as any,
      );
      expect(licensing.stampAnchorIfAbsent).not.toHaveBeenCalled();
    });
  });

  describe("capacity quantity", () => {
    it("INCREMENTS an existing capacity row instead of rejecting the purchase", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({
          code: "extra_branch",
          kind: "capacity",
          grants: { "limit.maxBranches": 1 },
        }),
      );
      (prisma.tenantAddOn.findFirst as any).mockImplementation(
        async ({ where }: any) =>
          where?.status === "active"
            ? { id: "ta-1", quantity: 2, chargedCents: 700_000, pricingMeta: {} }
            : null,
      );
      (prisma.tenantAddOn.update as any).mockImplementation(
        async ({ data }: any) => ({ id: "ta-1", quantity: 3, ...data }),
      );

      await svc.purchase(
        TENANT,
        {
          addOnCode: "extra_branch",
          quantity: 1,
          paymentRef: "CK-2",
          chargedCents: 388_000,
          periodEnd: PERIOD_END,
        },
        prisma as any,
      );

      const data = (prisma.tenantAddOn.update as any).mock.calls[0][0].data;
      expect(data.quantity).toEqual({ increment: 1 });
      // Already-paid units are never re-prorated; the history records what
      // THIS increment cost.
      expect(data.chargedCents).toBe(700_000 + 388_000);
      expect(data.pricingMeta.quantityHistory).toHaveLength(1);
      expect(data.pricingMeta.quantityHistory[0]).toMatchObject({
        from: 2,
        to: 3,
        chargedCents: 388_000,
      });
    });

    it("still rejects a duplicate NON-capacity product", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(catalogRow());
      (prisma.tenantAddOn.findFirst as any).mockImplementation(
        async ({ where }: any) =>
          where?.status === "active" ? { id: "ta-1", quantity: 1 } : null,
      );

      await expect(
        svc.purchase(
          TENANT,
          { addOnCode: "advanced_reports", paymentRef: "CK-3" },
          prisma as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("credits", () => {
    it("refuses to provision a credit pack as an ownership row", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({
          code: "credit_ai_photo_100",
          kind: "credit",
          billing: "oneTime",
          grants: {},
          creditKind: "PHOTO",
          creditUnits: 100,
        }),
      );
      await expect(
        svc.purchase(
          TENANT,
          { addOnCode: "credit_ai_photo_100", paymentRef: "CK-4" },
          prisma as any,
        ),
      ).rejects.toThrow(/purchaseCredits/);
    });

    it("mints a CreditLot with the line quantity folded in", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({
          code: "credit_ai_photo_100",
          kind: "credit",
          billing: "oneTime",
          priceCents: 69_000,
          grants: {},
          requiresLicense: false,
          creditKind: "PHOTO",
          creditUnits: 100,
        }),
      );
      (prisma.creditLot.findFirst as any).mockResolvedValue(null);
      (prisma.creditLot.create as any).mockImplementation(
        async ({ data }: any) => ({ id: "lot-1", ...data }),
      );

      await svc.purchaseCredits(
        TENANT,
        {
          addOnCode: "credit_ai_photo_100",
          quantity: 2,
          paymentRef: "CK-5",
          chargedCents: 138_000,
        },
        prisma as any,
      );

      const data = (prisma.creditLot.create as any).mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: TENANT,
        kind: "PHOTO",
        units: 200,
        source: "purchase:credit_ai_photo_100",
        paymentRef: "CK-5",
      });
    });

    it("is idempotent on a webhook replay", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({
          code: "credit_ai_photo_100",
          kind: "credit",
          billing: "oneTime",
          grants: {},
          requiresLicense: false,
          creditKind: "PHOTO",
          creditUnits: 100,
        }),
      );
      (prisma.creditLot.findFirst as any).mockResolvedValue({ id: "lot-existing" });

      const lot = await svc.purchaseCredits(
        TENANT,
        { addOnCode: "credit_ai_photo_100", paymentRef: "CK-5" },
        prisma as any,
      );

      expect(lot).toEqual({ id: "lot-existing" });
      expect(prisma.creditLot.create).not.toHaveBeenCalled();
    });

    it("refuses a paid credit pack with no payment and no comp", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({
          code: "credit_ai_photo_100",
          kind: "credit",
          billing: "oneTime",
          priceCents: 69_000,
          grants: {},
          requiresLicense: false,
          creditKind: "PHOTO",
          creditUnits: 100,
        }),
      );
      await expect(
        svc.purchaseCredits(TENANT, { addOnCode: "credit_ai_photo_100" }, prisma as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("operator comp", () => {
    it("grants a paid product without payment, audited, at zero charge", async () => {
      // The documented alternative to `featureOverrides`, which projects
      // {__replace:false} for every key it carries and would permanently
      // suppress a product the tenant later pays for.
      catalog.findByCodeOrThrow.mockResolvedValue(catalogRow());

      await svc.purchase(
        TENANT,
        { addOnCode: "advanced_reports", periodEnd: PERIOD_END },
        prisma as any,
        { comp: { actorId: "admin-9", reason: "goodwill" } },
      );

      const data = (prisma.tenantAddOn.create as any).mock.calls[0][0].data;
      expect(data).toMatchObject({
        origin: "comp",
        chargedCents: 0,
        compActorId: "admin-9",
        compReason: "goodwill",
      });
    });

    it("still refuses a paid product with neither payment nor comp", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(catalogRow());
      await expect(
        svc.purchase(TENANT, { addOnCode: "advanced_reports" }, prisma as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("dependencies", () => {
    it("no longer honours a retired plan: dep — it can never be satisfied", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({ deps: ["plan:PRO"] }),
      );
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);

      await expect(
        svc.purchase(
          TENANT,
          { addOnCode: "advanced_reports", paymentRef: "CK-6" },
          prisma as any,
        ),
      ).rejects.toThrow(/requires: plan:PRO/);
      // and it must NOT have gone looking for a subscription plan
      expect(prisma.subscriptionPlan.findMany).not.toHaveBeenCalled();
    });

    it("satisfies a dep from an active ownership row", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(
        catalogRow({ deps: ["module_ai_studio"] }),
      );
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        { addOn: { code: "module_ai_studio" } },
      ]);

      await expect(
        svc.purchase(
          TENANT,
          { addOnCode: "advanced_reports", paymentRef: "CK-7", periodEnd: PERIOD_END },
          prisma as any,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("isIncludedInEntitlements", () => {
    it("never marks the LICENCE as included — it must stay renewable", () => {
      // Otherwise the licence reads as covered the moment it is bought and
      // becomes unsellable, including at renewal, which is exactly when it
      // has to be buyable.
      const included = TenantMarketplaceService.isIncludedInEntitlements(
        { "feature.license": true },
        {
          features: { "feature.license": true },
          limits: {},
          integrations: {},
          computedAt: "",
        } as any,
      );
      expect(included).toBe(false);
    });
  });
});
