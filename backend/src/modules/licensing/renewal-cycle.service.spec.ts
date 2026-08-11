import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../common/test/prisma-mock.service";
import { RenewalCycleService } from "./renewal-cycle.service";

/**
 * The renewal is where a year's worth of purchases either continues or stops,
 * so the properties worth pinning are the ones whose failure is either a
 * wrong bill or a customer locked out of something they paid for.
 */
describe("RenewalCycleService", () => {
  let prisma: MockPrismaClient;
  let licensing: any;
  let quotes: { quote: jest.Mock };
  let svc: RenewalCycleService;

  const TENANT = "t-1";
  const ANCHOR = new Date("2026-03-10T00:00:00.000Z");
  const NEXT = new Date("2027-03-10T00:00:00.000Z");

  beforeEach(() => {
    prisma = mockPrismaClient();
    licensing = {
      loadContext: jest.fn().mockResolvedValue({
        tenantId: TENANT,
        anchorAt: ANCHOR,
        hasLicense: true,
        now: new Date("2027-02-15T00:00:00.000Z"),
        tz: "Europe/Istanbul",
      }),
    };
    quotes = {
      quote: jest.fn().mockResolvedValue({
        lines: [],
        currency: "TRY",
        subtotalCents: 340_833,
        taxCents: 68_167,
        shippingCents: 0,
        totalCents: 409_000,
        warnings: [],
        isPureRecurring: true,
      }),
    };
    svc = new RenewalCycleService(prisma as any, licensing, quotes as any);
    (prisma.renewalCycle.findUnique as any).mockResolvedValue(null);
    (prisma.renewalCycle.create as any).mockImplementation(
      async ({ data }: any) => ({ id: "rc-1", ...data }),
    );
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      {
        quantity: 1,
        pendingQuantity: null,
        branchId: null,
        addOn: { code: "license_annual" },
      },
      {
        quantity: 2,
        pendingQuantity: null,
        branchId: null,
        addOn: { code: "extra_branch" },
      },
    ]);
  });

  it("builds ONE cart covering everything the tenant owns", async () => {
    // The promise the whole model rests on: one anniversary, one invoice.
    const cycle: any = await svc.generate(TENANT);
    expect(cycle.anniversaryAt).toEqual(NEXT);
    expect(cycle.cartJson.items).toEqual([
      { type: "addon", code: "license_annual", qty: 1, branchId: undefined },
      { type: "addon", code: "extra_branch", qty: 2, branchId: undefined },
    ]);
  });

  it("prices AS OF the anniversary, so a renewal is full list price", async () => {
    // Quoting at "now" would day-prorate the renewal down to the stub of the
    // OLD cycle — the customer would be billed a fraction of what they owe.
    // On the anniversary itself remainingDays equals cycleDays, so proration
    // returns the whole year with no special-casing.
    await svc.generate(TENANT);
    expect(quotes.quote).toHaveBeenCalledWith(expect.anything(), TENANT, {
      now: NEXT,
    });
  });

  it("freezes the quote so the customer pays what the reminder said", async () => {
    const cycle: any = await svc.generate(TENANT);
    expect(cycle.totalCents).toBe(409_000);
    expect(cycle.quoteJson).toBeDefined();
  });

  it("sets the grace deadline a week past the anniversary", async () => {
    const cycle: any = await svc.generate(TENANT);
    expect(cycle.graceEndsAt).toEqual(
      new Date(NEXT.getTime() + 7 * 86_400_000),
    );
  });

  it("is idempotent per anniversary — replicas cannot double-generate", async () => {
    (prisma.renewalCycle.findUnique as any).mockResolvedValue({ id: "rc-old" });
    const cycle: any = await svc.generate(TENANT);
    expect(cycle.id).toBe("rc-old");
    expect(prisma.renewalCycle.create).not.toHaveBeenCalled();
  });

  it("generates nothing for a tenant who was never licensed", async () => {
    licensing.loadContext.mockResolvedValue({
      tenantId: TENANT,
      anchorAt: null,
      hasLicense: false,
      now: new Date(),
      tz: "UTC",
    });
    expect(await svc.generate(TENANT)).toBeNull();
  });

  it("generates nothing when there is nothing left to renew", async () => {
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([]);
    expect(await svc.generate(TENANT)).toBeNull();
  });

  it("honours a pending capacity DOWNGRADE at renewal", async () => {
    // Downgrades cannot apply mid-cycle without refunding a period the tenant
    // already paid for, so renewal is the only honest place for them.
    (prisma.tenantAddOn.findMany as any).mockResolvedValue([
      {
        quantity: 5,
        pendingQuantity: 2,
        branchId: null,
        addOn: { code: "extra_branch" },
      },
    ]);
    const cycle: any = await svc.generate(TENANT);
    expect(cycle.cartJson.items[0].qty).toBe(2);
  });

  it("excludes one-time products and anything already cancelled", async () => {
    await svc.generate(TENANT);
    const where = (prisma.tenantAddOn.findMany as any).mock.calls[0][0].where;
    // Credits and services are bought outright — billing them again yearly
    // would be charging for something the customer already owns outright.
    expect(where.addOn).toEqual({ billing: "annual" });
    expect(where.cancelAtPeriodEnd).toBe(false);
    expect(where.status).toEqual({ in: ["active", "past_due"] });
  });

  it("records a reminder atomically so two replicas cannot both send", async () => {
    // The array append and the "not already sent" check are ONE statement; a
    // read-then-write would let both replicas pass the check.
    (prisma.$executeRaw as any).mockResolvedValue(1);
    expect(await svc.markReminderSent("rc-1", 7)).toBe(true);

    (prisma.$executeRaw as any).mockResolvedValue(0);
    expect(await svc.markReminderSent("rc-1", 7)).toBe(false);
  });
});
