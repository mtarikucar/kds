import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { LicensingService } from "./licensing.service";

/**
 * LicensingService is the seam between "what the tenant's cycle is" and
 * "what a line costs". The behaviours pinned here are the ones whose failure
 * modes are money, not crashes:
 *
 *   - the context is loaded ONCE per cart, so an opening cart cannot disagree
 *     with itself about when the year starts;
 *   - `now` is supplied by the caller (the frozen pricing instant), never
 *     read from the clock inside pricing;
 *   - the anniversary anchor is written exactly once and never rewritten by a
 *     renewal, which is why it lives on Tenant and not on the ownership row.
 */
describe("LicensingService", () => {
  let prisma: MockPrismaClient;
  let entitlements: { getForTenant: jest.Mock };
  let svc: LicensingService;

  const TENANT = "t-1";
  const ANCHOR = new Date("2026-03-10T00:00:00.000Z");

  beforeEach(() => {
    prisma = mockPrismaClient();
    entitlements = { getForTenant: jest.fn().mockResolvedValue({ features: {} }) };
    svc = new LicensingService(prisma as any, entitlements as any);
  });

  describe("loadContext", () => {
    it("reads the anchor, the live-licence flag and the tenant timezone", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        licenseAnchorAt: ANCHOR,
        timezone: "Europe/Istanbul",
      });
      entitlements.getForTenant.mockResolvedValue({
        features: { "feature.license": true },
      });

      const now = new Date("2026-06-01T00:00:00.000Z");
      const ctx = await svc.loadContext(TENANT, now);

      expect(ctx).toEqual({
        tenantId: TENANT,
        anchorAt: ANCHOR,
        hasLicense: true,
        now,
        tz: "Europe/Istanbul",
      });
    });

    it("reports no licence when the engine does not grant feature.license", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        licenseAnchorAt: null,
        timezone: "UTC",
      });
      const ctx = await svc.loadContext(TENANT, new Date());
      expect(ctx.hasLicense).toBe(false);
      expect(ctx.anchorAt).toBeNull();
    });

    it("falls back to the default zone when the tenant has none", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue({
        licenseAnchorAt: null,
        timezone: "",
      });
      const ctx = await svc.loadContext(TENANT, new Date());
      expect(ctx.tz).toBe("Europe/Istanbul");
    });

    it("survives a missing tenant row rather than throwing mid-quote", async () => {
      (prisma.tenant.findUnique as any).mockResolvedValue(null);
      const ctx = await svc.loadContext(TENANT, new Date());
      expect(ctx.anchorAt).toBeNull();
      expect(ctx.hasLicense).toBe(false);
    });
  });

  describe("price", () => {
    const ctx = (over: Record<string, unknown> = {}) =>
      ({
        tenantId: TENANT,
        anchorAt: ANCHOR,
        hasLicense: true,
        now: new Date("2026-03-20T00:00:00.000Z"),
        tz: "Europe/Istanbul",
        ...over,
      }) as any;

    it("day-prorates to the anniversary", () => {
      const p = svc.price(ctx(), 129_000);
      expect(p.mode).toBe("prorated");
      expect(p.unitCents).toBe(125_466);
      expect(p.periodEnd).toEqual(new Date("2027-03-10T00:00:00.000Z"));
    });

    it("prices a first purchase (no anchor) as a full aligned cycle", () => {
      // The opening cart establishes the anchor, so nothing in it is
      // part-priced — every line runs a clean year from today.
      const p = svc.price(ctx({ anchorAt: null }), 129_000);
      expect(p.mode).toBe("full");
      expect(p.unitCents).toBe(129_000);
      expect(p.periodEnd).toEqual(new Date("2027-03-20T00:00:00.000Z"));
    });

    it("multiplies quantity without re-rounding", () => {
      const p = svc.price(ctx(), 129_000, { quantity: 3 });
      expect(p.subtotalCents).toBe(p.unitCents * 3);
    });

    it("prices by tenant-local CALENDAR DAY, not by time of day", () => {
      // 09:00 and 21:00 Istanbul are the same local day, so a quote run in
      // the morning and one run in the evening must cost the same.
      const morning = svc.price(
        ctx({ now: new Date("2026-03-20T06:00:00.000Z") }),
        129_000,
      );
      const evening = svc.price(
        ctx({ now: new Date("2026-03-20T18:00:00.000Z") }),
        129_000,
      );
      expect(evening.unitCents).toBe(morning.unitCents);
    });

    it("crosses to the next day at the TENANT's midnight, not UTC's", () => {
      // 22:00 UTC is already 01:00 the next day in Istanbul. This is exactly
      // the boundary CheckoutIntent.pricedAt exists to freeze: without the
      // replay, an intent taken just before it and settled just after would
      // re-quote a day cheaper and strand a paid cart.
      const before = svc.price(
        ctx({ now: new Date("2026-03-20T18:00:00.000Z") }), // 21:00 TRT, 20 Mar
        129_000,
      );
      const after = svc.price(
        ctx({ now: new Date("2026-03-20T22:00:00.000Z") }), // 01:00 TRT, 21 Mar
        129_000,
      );
      expect(after.remainingDays).toBe(before.remainingDays - 1);
      expect(after.unitCents).toBeLessThan(before.unitCents);
    });
  });

  describe("stampAnchorIfAbsent", () => {
    it("writes the anchor when the tenant has none", async () => {
      const tx = { tenant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
      await svc.stampAnchorIfAbsent(tx as any, TENANT, ANCHOR);
      expect(tx.tenant.updateMany).toHaveBeenCalledWith({
        // The null-scoped WHERE is the write-once guarantee.
        where: { id: TENANT, licenseAnchorAt: null },
        data: { licenseAnchorAt: ANCHOR },
      });
    });

    it("never rewrites an existing anchor — a late renewal must not shift the year", async () => {
      // This is the whole reason the anchor lives on Tenant and not on the
      // TenantAddOn row: purchase() rewrites activatedAt on every renewal, so
      // an anchor derived from ownership would drift forward each time a
      // customer paid late.
      const tx = { tenant: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
      await svc.stampAnchorIfAbsent(tx as any, TENANT, new Date("2027-05-05"));
      const where = tx.tenant.updateMany.mock.calls[0][0].where;
      expect(where.licenseAnchorAt).toBeNull();
    });
  });

  describe("nextAnniversaryFor", () => {
    it("returns null for a tenant that has never been licensed", () => {
      expect(svc.nextAnniversaryFor(null, new Date())).toBeNull();
    });

    it("returns the upcoming anniversary", () => {
      expect(
        svc.nextAnniversaryFor(ANCHOR, new Date("2026-06-01T00:00:00.000Z")),
      ).toEqual(new Date("2027-03-10T00:00:00.000Z"));
    });
  });
});
