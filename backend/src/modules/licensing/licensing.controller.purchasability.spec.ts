import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { LicensingController } from "./licensing.controller";

/**
 * What the storefront is told it may sell, and what state the licence is in.
 *
 * Both were reported by a customer on the same screen: the store offered
 * products the account already had, and adding any module to the basket also
 * added a SECOND licence to an account that already held one. Checkout refuses
 * both — and since a rejected line fails the entire cart, the purchase they
 * actually wanted failed too. The store was not lying so much as answering a
 * different question from the one checkout asks.
 */
describe("LicensingController — licence state and purchasability", () => {
  let prisma: MockPrismaClient;
  let ctrl: LicensingController;
  let entitlements: { getForTenant: jest.Mock };
  let licensing: {
    loadContext: jest.Mock;
    nextAnniversaryFor: jest.Mock;
    price: jest.Mock;
  };

  const TENANT = "t-1";
  const req = { user: { tenantId: TENANT } };

  const catalogRow = (over: Record<string, unknown> = {}) => ({
    code: "module_personnel",
    name: "Personel Yönetimi",
    kind: "module",
    billing: "annual",
    priceCents: 99_000,
    currency: "TRY",
    grants: { "feature.personnelManagement": true },
    requiresLicense: true,
    maxQuantity: null,
    i18n: null,
    ...over,
  });

  const ent = (over: Record<string, unknown> = {}) => ({
    features: { "feature.license": true },
    limits: {},
    integrations: {},
    computedAt: "2026-08-12T00:00:00.000Z",
    ...over,
  });

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = { getForTenant: jest.fn().mockResolvedValue(ent()) };
    licensing = {
      loadContext: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        anchorAt: new Date("2026-03-10T00:00:00.000Z"),
        hasLicense: true,
        now: new Date("2026-08-12T09:00:00.000Z"),
        tz: "Europe/Istanbul",
      }),
      nextAnniversaryFor: jest
        .fn()
        .mockReturnValue(new Date("2027-03-10T00:00:00.000Z")),
      // buildOffers prices every annual row; the figures are covered by
      // licensing.service.spec — here they only need to exist.
      price: jest.fn().mockImplementation((_ctx: unknown, cents: number) => ({
        unitCents: cents,
        subtotalCents: cents,
        periodEnd: new Date("2027-03-10T00:00:00.000Z"),
      })),
    };

    ctrl = new LicensingController(
      prisma as any,
      entitlements as any,
      licensing as any,
      { balances: jest.fn().mockResolvedValue([]) } as any,
      { openFor: jest.fn().mockResolvedValue(null) } as any,
      { listForTenant: jest.fn().mockResolvedValue([]) } as any,
    );

    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([catalogRow()]);
  });

  describe("licence state", () => {
    it("reports a live licence as active even with no anniversary anchor", async () => {
      // THE BUG: state started with `!anchorAt ? "none"`. A tenant holding a
      // live licence with no anchor — a comped one, or anything provisioned
      // outside purchase() — was reported unlicensed, so the store added a
      // second licence to every basket and checkout refused the lot.
      licensing.loadContext.mockResolvedValue({
        tenantId: TENANT,
        anchorAt: null,
        hasLicense: true,
        now: new Date(),
        tz: "Europe/Istanbul",
      });
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        {
          id: "ta-1",
          quantity: 1,
          status: "active",
          origin: "comp",
          compReason: null,
          currentPeriodEnd: null,
          chargedCents: 0,
          addOn: {
            code: "license_annual",
            name: "Lisans",
            kind: "license",
            priceCents: 299_000,
            currency: "TRY",
            i18n: null,
          },
        },
      ]);

      const res = await ctrl.me(req);
      expect(res.license.status).toBe("active");
    });

    it("reports grace while the licence row is past_due", async () => {
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        {
          id: "ta-1",
          quantity: 1,
          status: "past_due",
          origin: "purchase",
          compReason: null,
          currentPeriodEnd: new Date("2026-08-10T00:00:00.000Z"),
          chargedCents: 299_000,
          addOn: {
            code: "license_annual",
            name: "Lisans",
            kind: "license",
            priceCents: 299_000,
            currency: "TRY",
            i18n: null,
          },
        },
      ]);

      expect((await ctrl.me(req)).license.status).toBe("grace");
    });

    it("reports expired once the entitlement is gone but the anchor remains", async () => {
      licensing.loadContext.mockResolvedValue({
        tenantId: TENANT,
        anchorAt: new Date("2026-03-10T00:00:00.000Z"),
        hasLicense: false,
        now: new Date(),
        tz: "Europe/Istanbul",
      });
      entitlements.getForTenant.mockResolvedValue(ent({ features: {} }));

      expect((await ctrl.me(req)).license.status).toBe("expired");
    });

    it("reports none for an account that has never held one", async () => {
      licensing.loadContext.mockResolvedValue({
        tenantId: TENANT,
        anchorAt: null,
        hasLicense: false,
        now: new Date(),
        tz: "Europe/Istanbul",
      });
      entitlements.getForTenant.mockResolvedValue(ent({ features: {} }));

      expect((await ctrl.me(req)).license.status).toBe("none");
    });
  });

  describe("purchasability", () => {
    it("marks a product the account already has as unbuyable, with no ownership row anywhere", async () => {
      // The demo tenant's whole feature set arrives as operator overrides, so
      // it owns nothing — and the store used ownership rows to decide what to
      // offer. Same verdict function as the pre-payment guard now.
      entitlements.getForTenant.mockResolvedValue(
        ent({
          features: {
            "feature.license": true,
            "feature.personnelManagement": true,
          },
        }),
      );

      const res = await ctrl.me(req);
      expect(res.purchasability.module_personnel).toMatchObject({
        ok: false,
        reason: "ADDON_ALREADY_GRANTED",
      });
    });

    it("marks it buyable when the account does not have it", async () => {
      const res = await ctrl.me(req);
      expect(res.purchasability.module_personnel.ok).toBe(true);
    });

    it("keeps a licence-gated product buyable for an unlicensed account", async () => {
      // The store adds the licence to the basket itself, so LICENSE_REQUIRED
      // must not read as "cannot be sold" — otherwise a tenant who has bought
      // nothing sees an entirely greyed-out catalogue.
      entitlements.getForTenant.mockResolvedValue(ent({ features: {} }));
      licensing.loadContext.mockResolvedValue({
        tenantId: TENANT,
        anchorAt: null,
        hasLicense: false,
        now: new Date(),
        tz: "Europe/Istanbul",
      });

      const res = await ctrl.me(req);
      expect(res.purchasability.module_personnel.ok).toBe(true);
    });

    it("refuses a second licence to an account that holds one", async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
        catalogRow({
          code: "license_annual",
          name: "Lisans",
          kind: "license",
          grants: { "feature.license": true },
          requiresLicense: false,
        }),
      ]);

      const res = await ctrl.me(req);
      expect(res.purchasability.license_annual).toMatchObject({
        ok: false,
        reason: "ADDON_ALREADY_OWNED",
      });
    });

    it("keeps credit packs buyable however many the account already bought", async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
        catalogRow({
          code: "credit_ai_photo_100",
          name: "100 AI Görsel",
          kind: "credit",
          billing: "oneTime",
          grants: { "credit.PHOTO": 100 },
          requiresLicense: false,
        }),
      ]);
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);

      const res = await ctrl.me(req);
      expect(res.purchasability.credit_ai_photo_100.ok).toBe(true);
    });

    it("stops selling capacity at the catalog ceiling", async () => {
      (prisma.marketplaceAddOn.findMany as any).mockResolvedValue([
        catalogRow({
          code: "extra_branch",
          name: "Ek Şube",
          kind: "capacity",
          grants: { "limit.maxBranches": 1 },
          maxQuantity: 2,
        }),
      ]);
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        {
          id: "ta-2",
          quantity: 2,
          status: "active",
          origin: "purchase",
          compReason: null,
          currentPeriodEnd: new Date("2027-03-10T00:00:00.000Z"),
          chargedCents: 798_000,
          addOn: {
            code: "extra_branch",
            name: "Ek Şube",
            kind: "capacity",
            priceCents: 399_000,
            currency: "TRY",
            i18n: null,
          },
        },
      ]);

      const res = await ctrl.me(req);
      expect(res.purchasability.extra_branch).toMatchObject({
        ok: false,
        reason: "ADDON_MAX_QUANTITY",
      });
    });
  });
});
