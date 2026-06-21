import { BadRequestException } from "@nestjs/common";
import { CheckoutService } from "./checkout.service";

/**
 * Wave-4 money-path regressions for confirmAndProvision:
 *  - hardware order total INCLUDES tax (it used to omit KDV);
 *  - provisioning HALTS when the re-quote total diverges from the charged
 *    amount (a price change between intent and settlement);
 *  - add-on grants JOIN the outer transaction (purchase receives the tx).
 */
describe("CheckoutService.confirmAndProvision (Wave-4)", () => {
  const PAYMENT_REF = "CK-1";
  const TENANT = "t-1";

  let prisma: any;
  let quoteSvc: any;
  let catalog: any;
  let tenantMarketplace: any;
  let outbox: any;
  let tx: any;
  let svc: CheckoutService;

  function makeQuote(over: Partial<any> = {}) {
    return {
      lines: [
        {
          type: "hardware",
          code: "sku1",
          name: "Printer",
          qty: 1,
          unitCents: 10000,
          subtotalCents: 10000,
          meta: { productId: "p1", acquisition: "sell" },
        },
      ],
      subtotalCents: 10000,
      taxCents: 2000,
      shippingCents: 500,
      totalCents: 12500,
      currency: "TRY",
      ...over,
    };
  }

  beforeEach(() => {
    tx = {
      hardwareOrder: { create: jest.fn().mockResolvedValue({ id: "ho1" }) },
      hardwareOrderItem: { create: jest.fn().mockResolvedValue({}) },
      installationRequest: { create: jest.fn().mockResolvedValue({}) },
      outboxEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      checkoutIntent: {
        findFirst: jest.fn().mockResolvedValue({
          status: "succeeded",
          cartJson: { branchId: undefined },
          amountCents: 12500, // matches quote.totalCents by default
        }),
      },
      hardwareOrder: { findFirst: jest.fn().mockResolvedValue(null) },
      tenantAddOn: { findMany: jest.fn().mockResolvedValue([]) },
      branch: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
    };
    quoteSvc = { quote: jest.fn().mockResolvedValue(makeQuote()) };
    catalog = { allocate: jest.fn().mockResolvedValue({ serials: [] }) };
    tenantMarketplace = {
      purchase: jest.fn().mockResolvedValue({ id: "ta1" }),
    };
    outbox = { append: jest.fn().mockResolvedValue("evt") };

    svc = new CheckoutService(
      prisma,
      outbox,
      quoteSvc,
      catalog,
      tenantMarketplace,
    );
  });

  it("persists a hardware total that includes tax (subtotal + tax + shipping)", async () => {
    await svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF);

    expect(tx.hardwareOrder.create).toHaveBeenCalledTimes(1);
    const data = tx.hardwareOrder.create.mock.calls[0][0].data;
    expect(data.subtotalCents).toBe(10000);
    expect(data.taxCents).toBe(2000);
    expect(data.shippingCents).toBe(500);
    expect(data.totalCents).toBe(12500); // was 10500 before the fix (tax omitted)
  });

  it("halts provisioning when the re-quote diverges from the charged amount", async () => {
    prisma.checkoutIntent.findFirst.mockResolvedValue({
      status: "succeeded",
      cartJson: { branchId: undefined },
      amountCents: 99999, // charged ≠ re-quoted 12500
    });

    await expect(
      svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.hardwareOrder.create).not.toHaveBeenCalled();
  });

  it("threads the outer transaction into the add-on purchase", async () => {
    quoteSvc.quote.mockResolvedValue(
      makeQuote({
        lines: [
          {
            type: "addon",
            code: "kds_extra_screen",
            name: "Extra screen",
            qty: 1,
            unitCents: 12500,
            subtotalCents: 12500,
            meta: {},
          },
        ],
        subtotalCents: 12500,
        taxCents: 0,
        shippingCents: 0,
        totalCents: 12500,
      }),
    );

    await svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF);

    expect(tenantMarketplace.purchase).toHaveBeenCalledTimes(1);
    // 3rd arg is the transaction client → grant commits atomically with the cart.
    expect(tenantMarketplace.purchase.mock.calls[0][2]).toBe(tx);
  });
});
