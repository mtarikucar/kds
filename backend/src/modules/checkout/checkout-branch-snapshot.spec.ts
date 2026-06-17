import { BadRequestException } from "@nestjs/common";
import { CheckoutService } from "./checkout.service";

/**
 * v2.8.99.3 — `cart.branchId` is the "ship to my branch" snapshot the
 * hardware-store shipping form attaches when the buyer picks one of
 * their tenant's branches instead of typing a custom address.
 *
 * Invariants this spec pins:
 *   - branchId in the cart → looked up on Branch table scoped to
 *     (id, tenantId, status='active') → persisted onto
 *     HardwareOrder.branchId
 *   - branchId for a foreign tenant → BadRequestException
 *   - branchId for an archived/suspended branch → BadRequestException
 *   - no branchId in the cart → HardwareOrder.branchId stays null
 *
 * The actual shipping address always lives in HardwareOrder.shippingAddress
 * (Json), independent of branchId — branchId is the reference, address
 * is the snapshot. If Branch.address mutates after the order is placed,
 * the order row must not move.
 */
describe("CheckoutService — branchId snapshot (v2.8.99.3)", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let svc: CheckoutService;

  let createdOrder: any;

  beforeEach(() => {
    createdOrder = null;
    const tx = {
      hardwareOrder: {
        create: jest.fn(async (args: any) => {
          createdOrder = { id: "hw-1", ...args.data };
          return createdOrder;
        }),
      },
      hardwareOrderItem: { create: jest.fn() },
      installationRequest: { create: jest.fn() },
      outboxEvent: { create: jest.fn() },
    };
    prisma = {
      // C1 payment gate: a supplied paymentRef must resolve to a settled
      // CheckoutIntent before provisioning.
      checkoutIntent: {
        findFirst: jest.fn().mockResolvedValue({ status: "succeeded" }),
      },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = { quote: jest.fn() };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
    );
  });

  function singleHardwareQuote() {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "hardware",
          code: "yazarkasa-beko-300tr",
          name: "Beko 300TR",
          qty: 1,
          unitCents: 650000,
          subtotalCents: 650000,
          cadence: "oneTime",
          meta: { productId: "prod-1", acquisition: "sell" },
        },
      ],
      currency: "TRY",
      subtotalCents: 650000,
      taxCents: 130000,
      shippingCents: 5000,
      totalCents: 785000,
      warnings: [],
      isPureRecurring: false,
    });
  }

  it("persists HardwareOrder.branchId when branchId is a tenant-owned active branch", async () => {
    prisma.branch.findFirst.mockResolvedValue({ id: "branch-istanbul" });
    singleHardwareQuote();

    await svc.confirmAndProvision(
      "t-1",
      {
        items: [] as any,
        branchId: "branch-istanbul",
        shippingAddress: { line1: "Atatürk Cad. 12", city: "İstanbul" },
      },
      null,
      { allowComp: true },
    );

    // Look-up was tenant-scoped + status=active.
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: { id: "branch-istanbul", tenantId: "t-1", status: "active" },
      select: { id: true },
    });
    expect(createdOrder.branchId).toBe("branch-istanbul");
    // Address still copied as snapshot (the address is the source of
    // truth on the order; branchId is just the reference).
    expect(createdOrder.shippingAddress).toMatchObject({
      line1: "Atatürk Cad. 12",
      city: "İstanbul",
    });
  });

  it("rejects with BadRequest when branchId belongs to another tenant", async () => {
    // findFirst returns null because the WHERE includes tenantId=t-1.
    prisma.branch.findFirst.mockResolvedValue(null);
    singleHardwareQuote();

    await expect(
      svc.confirmAndProvision(
        "t-1",
        {
          items: [] as any,
          branchId: "foreign-tenant-branch",
        },
        null,
        { allowComp: true },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createdOrder).toBeNull();
  });

  it("rejects with BadRequest when the branch exists but is suspended/archived", async () => {
    // Status filter excludes non-active branches, so findFirst returns null.
    prisma.branch.findFirst.mockResolvedValue(null);
    singleHardwareQuote();

    await expect(
      svc.confirmAndProvision(
        "t-1",
        { items: [] as any, branchId: "archived-branch" },
        null,
        { allowComp: true },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("leaves HardwareOrder.branchId null when the cart has no branchId (manual address mode)", async () => {
    singleHardwareQuote();

    await svc.confirmAndProvision(
      "t-1",
      {
        items: [] as any,
        shippingAddress: { line1: "Custom address", city: "Bursa" },
      },
      null,
      { allowComp: true },
    );

    // No branch lookup at all on the manual-address path.
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(createdOrder.branchId).toBeNull();
  });
});
