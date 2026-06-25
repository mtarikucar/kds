import { CheckoutService } from "./checkout.service";

/**
 * Hardware purchase → device-mesh provisioning wiring.
 *
 * After a paid hardware order is committed, CheckoutService asks
 * DeviceService.provisionPurchasedDevices to create unprovisioned slots for the
 * device-class lines, looking up each line's HardwareProduct.category so the
 * mesh knows which `kind` of slot to mint. The call is best-effort (post-commit,
 * swallowed) and idempotent — so it also runs on the idempotent-replay path to
 * self-heal a run that crashed after commit but before the hook.
 */
describe("CheckoutService — hardware → device provisioning", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let devices: { provisionPurchasedDevices: jest.Mock };
  let svc: CheckoutService;

  beforeEach(() => {
    const tx = {
      hardwareOrder: {
        create: jest.fn(async (args: any) => ({ id: "hw-1", ...args.data })),
      },
      hardwareOrderItem: { create: jest.fn() },
      installationRequest: { create: jest.fn() },
      outboxEvent: { create: jest.fn() },
    };
    prisma = {
      checkoutIntent: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ status: "succeeded", cartJson: { items: [] } }),
      },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      hardwareProduct: {
        findMany: jest.fn().mockResolvedValue([
          { id: "prod-kds", category: "kds_screen" },
          { id: "prod-prn", category: "printer" },
        ]),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = { quote: jest.fn() };
    devices = { provisionPurchasedDevices: jest.fn().mockResolvedValue(2) };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
      null as any, // metrics
      devices as any,
    );
  });

  function hardwareQuote() {
    return {
      lines: [
        {
          type: "hardware",
          code: "KDS-1",
          name: "KDS Screen",
          qty: 2,
          unitCents: 500000,
          subtotalCents: 1000000,
          cadence: "oneTime",
          meta: { productId: "prod-kds", acquisition: "sell" },
        },
        {
          type: "hardware",
          code: "PRN-1",
          name: "Receipt Printer",
          qty: 1,
          unitCents: 200000,
          subtotalCents: 200000,
          cadence: "oneTime",
          meta: { productId: "prod-prn", acquisition: "sell" },
        },
      ],
      currency: "TRY",
      subtotalCents: 1200000,
      taxCents: 240000,
      shippingCents: 0,
      totalCents: 1440000,
      warnings: [],
      isPureRecurring: false,
    };
  }

  it("provisions device slots with category resolved from the catalog", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote());

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1");

    expect(devices.provisionPurchasedDevices).toHaveBeenCalledTimes(1);
    const [tenantId, branchId, orderId, items] =
      devices.provisionPurchasedDevices.mock.calls[0];
    expect(tenantId).toBe("t-1");
    expect(branchId).toBeNull(); // no cart branchId → DeviceService resolves
    expect(orderId).toBe("hw-1");
    expect(items).toEqual([
      { productId: "prod-kds", sku: "KDS-1", qty: 2, category: "kds_screen" },
      { productId: "prod-prn", sku: "PRN-1", qty: 1, category: "printer" },
    ]);
  });

  it("does not call provisioning when there are no hardware lines", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "addon",
          code: "fiscal_hugin",
          name: "Fiscal",
          qty: 1,
          unitCents: 0,
          subtotalCents: 0,
          cadence: "monthly",
          meta: { addOnCode: "fiscal_hugin" },
        },
      ],
      currency: "TRY",
      subtotalCents: 0,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 0,
      warnings: [],
      isPureRecurring: true,
    });
    tenantMarketplace.purchase.mockResolvedValue({ id: "ta-1" });

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1");

    expect(devices.provisionPurchasedDevices).not.toHaveBeenCalled();
  });

  it("self-heals provisioning on idempotent replay using the existing order's items", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote());
    // The order already exists (a prior run committed it) → idempotent replay.
    prisma.hardwareOrder.findFirst.mockResolvedValue({
      id: "hw-1",
      branchId: "branch-9",
      items: [{ productId: "prod-kds", sku: "KDS-1", qty: 2 }],
    });

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1");

    expect(devices.provisionPurchasedDevices).toHaveBeenCalledTimes(1);
    const [tenantId, branchId, orderId, items] =
      devices.provisionPurchasedDevices.mock.calls[0];
    expect(tenantId).toBe("t-1");
    expect(branchId).toBe("branch-9");
    expect(orderId).toBe("hw-1");
    expect(items).toEqual([
      { productId: "prod-kds", sku: "KDS-1", qty: 2, category: "kds_screen" },
    ]);
  });

  it("never lets a provisioning failure surface to the buyer", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote());
    devices.provisionPurchasedDevices.mockRejectedValue(
      new Error("device-mesh down"),
    );

    await expect(
      svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1"),
    ).resolves.toMatchObject({ hardwareOrderId: "hw-1" });
  });
});
