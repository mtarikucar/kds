import { CheckoutService } from "./checkout.service";

/**
 * Track 2 — checkout_provisions_total domain counter.
 *
 * After a cart is provisioned inside the single $transaction, the façade
 * records one Prometheus tick labeled by the developer-controlled
 * provisioning `result`:
 *   - "paid"   — a real paymentRef was supplied (webhook-confirmed checkout)
 *   - "comped" — null paymentRef (super-admin force-complete)
 *
 * Mirrors the merged stock_movements_total pattern: @Optional()
 * MetricsService injected last in the ctor, increment AFTER the committed
 * $transaction, and ?.-guarded so a missing collaborator can never break the
 * provisioning write.
 */
describe("CheckoutService — checkout_provisions_total counter", () => {
  let prisma: any;
  let outbox: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let metrics: { incCounter: jest.Mock };
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
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    outbox = { append: jest.fn() };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = { purchase: jest.fn() };
    quoteSvc = { quote: jest.fn() };
    metrics = { incCounter: jest.fn() };
    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
      metrics as any,
    );
  });

  function emptyQuote() {
    quoteSvc.quote.mockResolvedValue({
      lines: [],
      currency: "TRY",
      subtotalCents: 0,
      taxCents: 0,
      shippingCents: 0,
      totalCents: 0,
      warnings: [],
      isPureRecurring: false,
    });
  }

  it('records result="paid" when a paymentRef is supplied', async () => {
    emptyQuote();
    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1");
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "checkout_provisions_total",
      expect.any(String),
      { result: "paid" },
    );
  });

  it('records result="comped" when paymentRef is null (force-complete)', async () => {
    emptyQuote();
    await svc.confirmAndProvision("t-1", { items: [] as any }, null);
    expect(metrics.incCounter).toHaveBeenCalledWith(
      "checkout_provisions_total",
      expect.any(String),
      { result: "comped" },
    );
  });

  it("does not record when an idempotent replay short-circuits provisioning", async () => {
    emptyQuote();
    // An existing HardwareOrder for the same paymentRef → cached summary
    // path returns before the $transaction provisions anything.
    prisma.hardwareOrder.findFirst.mockResolvedValue({ id: "hw-existing" });
    prisma.tenantAddOn = { findMany: jest.fn().mockResolvedValue([]) };

    await svc.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1");
    expect(metrics.incCounter).not.toHaveBeenCalled();
  });

  it("does not throw when no MetricsService is injected (optional dep)", async () => {
    emptyQuote();
    const bare = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
    );
    await expect(
      bare.confirmAndProvision("t-1", { items: [] as any }, "pay-ref-1"),
    ).resolves.toBeDefined();
  });
});
