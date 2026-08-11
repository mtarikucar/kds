import { BadRequestException } from "@nestjs/common";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { SuperadminEntitlementsController } from "./superadmin-entitlements.controller";

/**
 * Operator comp — the replacement for `Tenant.featureOverrides`.
 *
 * Two properties matter more than the happy path. A comp must be routed by
 * kind (a credit pack is a balance, not an ownership row, and purchase()
 * rejects it outright), and a revoke must refuse to touch anything the tenant
 * PAID for — taking away a purchase is a refund decision that has to happen on
 * the payment rail first, not a panel click.
 */
describe("SuperadminEntitlementsController", () => {
  let prisma: MockPrismaClient;
  let marketplace: {
    purchase: jest.Mock;
    purchaseCredits: jest.Mock;
    cancel: jest.Mock;
  };
  let catalog: { findByCodeOrThrow: jest.Mock };
  let projector: { projectTenant: jest.Mock };
  let licensing: { loadContext: jest.Mock; nextAnniversaryFor: jest.Mock };
  let credits: { balances: jest.Mock };
  let audit: { log: jest.Mock };
  let ctrl: SuperadminEntitlementsController;

  const ACTOR = { id: "sa-1", email: "ops@hummytummy.com" };
  const TENANT = "t-1";

  beforeEach(() => {
    prisma = mockPrismaClient();
    marketplace = {
      purchase: jest.fn().mockResolvedValue({ id: "ta-1" }),
      purchaseCredits: jest.fn().mockResolvedValue({ id: "lot-1" }),
      cancel: jest.fn().mockResolvedValue({ id: "ta-1", status: "cancelled" }),
    };
    catalog = { findByCodeOrThrow: jest.fn() };
    projector = { projectTenant: jest.fn().mockResolvedValue(undefined) };
    licensing = {
      loadContext: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        anchorAt: new Date("2026-03-10T00:00:00.000Z"),
        hasLicense: true,
        now: new Date("2026-08-11T09:00:00.000Z"),
        tz: "Europe/Istanbul",
      }),
      nextAnniversaryFor: jest
        .fn()
        .mockReturnValue(new Date("2027-03-10T00:00:00.000Z")),
    };
    credits = { balances: jest.fn().mockResolvedValue([]) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    ctrl = new SuperadminEntitlementsController(
      prisma as any,
      marketplace as any,
      catalog as any,
      projector as any,
      licensing as any,
      credits as any,
      audit as any,
    );

    (prisma.tenant.findUnique as any).mockResolvedValue({
      id: TENANT,
      name: "Kadıköy Restoran",
      licenseAnchorAt: new Date("2026-03-10T00:00:00.000Z"),
    });
  });

  const module = (over: Record<string, unknown> = {}) => ({
    code: "module_personnel",
    kind: "module",
    priceCents: 99_000,
    requiresLicense: true,
    ...over,
  });

  describe("comp", () => {
    it("mints an ownership row carrying who granted it and why", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(module());

      await ctrl.comp(
        {
          tenantId: TENANT,
          addOnCode: "module_personnel",
          reason: "Pilot müşteri",
        },
        ACTOR,
      );

      expect(marketplace.purchase).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({ addOnCode: "module_personnel", quantity: 1 }),
        undefined,
        { comp: { actorId: "sa-1", reason: "Pilot müşteri" } },
      );
    });

    it("projects inline so the panel does not show a stale tenant", async () => {
      // purchase() only emits AddOnPurchased; waiting on the event rail would
      // show the operator a tenant that still lacks what they just granted.
      catalog.findByCodeOrThrow.mockResolvedValue(module());
      await ctrl.comp(
        { tenantId: TENANT, addOnCode: "module_personnel", reason: "x" },
        ACTOR,
      );
      expect(projector.projectTenant).toHaveBeenCalledWith(TENANT);
    });

    it("routes a credit pack to purchaseCredits, never to purchase", async () => {
      // purchase() throws on kind==='credit'; without this branch the operator
      // would get a 400 telling them to call a method they cannot reach.
      catalog.findByCodeOrThrow.mockResolvedValue(
        module({ code: "credit_ai_photo_100", kind: "credit", requiresLicense: false }),
      );

      await ctrl.comp(
        {
          tenantId: TENANT,
          addOnCode: "credit_ai_photo_100",
          quantity: 2,
          reason: "demo",
        },
        ACTOR,
      );

      expect(marketplace.purchaseCredits).toHaveBeenCalledWith(
        TENANT,
        { addOnCode: "credit_ai_photo_100", quantity: 2 },
        undefined,
        { comp: { actorId: "sa-1", reason: "demo" } },
      );
      expect(marketplace.purchase).not.toHaveBeenCalled();
      // Credits are a balance — nothing to project.
      expect(projector.projectTenant).not.toHaveBeenCalled();
    });

    it("warns when the comped product will stay dark for lack of a licence", async () => {
      licensing.loadContext.mockResolvedValue({
        tenantId: TENANT,
        anchorAt: null,
        hasLicense: false,
        now: new Date(),
        tz: "Europe/Istanbul",
      });
      catalog.findByCodeOrThrow.mockResolvedValue(module());

      const res = await ctrl.comp(
        { tenantId: TENANT, addOnCode: "module_personnel", reason: "x" },
        ACTOR,
      );

      expect(res.warning).toMatch(/no active licence/i);
    });

    it("writes an audit entry naming the actor, the tenant and the reason", async () => {
      catalog.findByCodeOrThrow.mockResolvedValue(module());
      await ctrl.comp(
        { tenantId: TENANT, addOnCode: "module_personnel", reason: "sözleşme" },
        ACTOR,
      );

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "sa-1",
          actorEmail: "ops@hummytummy.com",
          targetTenantId: TENANT,
          targetTenantName: "Kadıköy Restoran",
          metadata: expect.objectContaining({ reason: "sözleşme" }),
        }),
      );
    });

    it("rejects an unknown tenant before touching the catalog", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(null);
      await expect(
        ctrl.comp({ tenantId: "nope", addOnCode: "x", reason: "y" }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(catalog.findByCodeOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("revokeComp", () => {
    it("cancels a comped row immediately and re-projects", async () => {
      (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
        id: "ta-1",
        origin: "comp",
        status: "active",
        addOn: { code: "module_personnel" },
      });

      await ctrl.revokeComp("ta-1", TENANT, ACTOR);

      expect(marketplace.cancel).toHaveBeenCalledWith(TENANT, "ta-1", true);
      expect(projector.projectTenant).toHaveBeenCalledWith(TENANT);
    });

    it("refuses to revoke something the tenant paid for", async () => {
      (prisma.tenantAddOn.findFirst as any).mockResolvedValue({
        id: "ta-2",
        origin: "purchase",
        status: "active",
        addOn: { code: "module_inventory" },
      });

      await expect(ctrl.revokeComp("ta-2", TENANT, ACTOR)).rejects.toThrow(
        /purchased, not comped/i,
      );
      expect(marketplace.cancel).not.toHaveBeenCalled();
    });

    it("requires a tenantId so a row cannot be revoked cross-tenant by id alone", async () => {
      await expect(
        ctrl.revokeComp("ta-1", "" as any, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("tenantLicensing", () => {
    it("marks an owned product dark when the licence is not live", async () => {
      licensing.loadContext.mockResolvedValue({
        tenantId: TENANT,
        anchorAt: new Date("2026-03-10T00:00:00.000Z"),
        hasLicense: false,
        now: new Date("2026-08-11T09:00:00.000Z"),
        tz: "Europe/Istanbul",
      });
      (prisma.tenantAddOn.findMany as any).mockResolvedValue([
        {
          id: "ta-1",
          quantity: 1,
          status: "active",
          origin: "purchase",
          compReason: null,
          currentPeriodEnd: new Date("2027-03-10T00:00:00.000Z"),
          chargedCents: 99_000,
          addOn: {
            code: "module_personnel",
            name: "Personel",
            kind: "module",
            priceCents: 99_000,
            currency: "TRY",
            requiresLicense: true,
          },
        },
      ]);

      const res = await ctrl.tenantLicensing(TENANT);

      expect(res.license.active).toBe(false);
      expect(res.owned[0].suppressedByLicence).toBe(true);
    });
  });
});
