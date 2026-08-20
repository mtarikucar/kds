import { BadRequestException } from "@nestjs/common";
import { CheckoutService } from "./checkout.service";

/**
 * Wave-4 money-path regressions for confirmAndProvision:
 *  - hardware order total INCLUDES tax (it used to omit KDV);
 *  - provisioning HALTS when the re-quote total diverges from the charged
 *    amount (a price change between intent and settlement);
 *  - add-on grants JOIN the outer transaction (purchase receives the tx).
 */
// v3.3.0 — CheckoutService writes the itemized tenant invoice inside the
// provisioning transaction, so a bare construction needs the collaborator.
const tenantInvoices = { createFromQuote: jest.fn().mockResolvedValue({ id: "inv-1" }) };

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
      // KDV-inclusive: line gross 10000 → net 8333 + embedded tax 1667;
      // total = gross 10000 + shipping 500.
      subtotalCents: 8333,
      taxCents: 1667,
      shippingCents: 500,
      totalCents: 10500,
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
          amountCents: 10500, // matches quote.totalCents by default
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
      tenantInvoices as any,
    );
  });

  it("persists a KDV-inclusive hardware order (net + embedded tax + shipping = gross+shipping)", async () => {
    await svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF);

    expect(tx.hardwareOrder.create).toHaveBeenCalledTimes(1);
    const data = tx.hardwareOrder.create.mock.calls[0][0].data;
    // gross line 10000 → net 8333 + embedded tax 1667; total = gross + shipping.
    expect(data.subtotalCents).toBe(8333);
    expect(data.taxCents).toBe(1667);
    expect(data.shippingCents).toBe(500);
    expect(data.totalCents).toBe(10500); // gross 10000 + shipping 500 — NOT 12500 (no tax on top)
    expect(data.subtotalCents + data.taxCents + data.shippingCents).toBe(10500);
  });

  it("halts provisioning when the re-quote diverges from the charged amount", async () => {
    prisma.checkoutIntent.findFirst.mockResolvedValue({
      status: "succeeded",
      cartJson: { branchId: undefined },
      amountCents: 99999, // charged ≠ re-quoted 10500
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
            unitCents: 10500,
            subtotalCents: 10500, // gross line == total
            meta: {},
          },
        ],
        subtotalCents: 8750, // net = round(10500 / 1.2)
        taxCents: 1750,
        shippingCents: 0,
        totalCents: 10500, // gross, matches the charged amountCents
      }),
    );

    await svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF);

    expect(tenantMarketplace.purchase).toHaveBeenCalledTimes(1);
    // 3rd arg is the transaction client → grant commits atomically with the cart.
    expect(tenantMarketplace.purchase.mock.calls[0][2]).toBe(tx);
  });

  it("provisions a dependent module after its parent regardless of cart order", async () => {
    // The unit-level proof is provision-order.spec.ts; this pins that
    // confirmAndProvision actually USES it. Cart order is click order, so the
    // customer decides it.
    quoteSvc.quote.mockResolvedValue(
      makeQuote({
        lines: [
          {
            type: "addon",
            code: "module_personnel_card_shift",
            name: "Kartlı Vardiya",
            qty: 1,
            unitCents: 400_000,
            subtotalCents: 400_000,
            meta: { kind: "module", deps: ["module_personnel"] },
          },
          {
            type: "addon",
            code: "module_personnel",
            name: "Personel Yönetimi",
            qty: 1,
            unitCents: 99_000,
            subtotalCents: 99_000,
            meta: { kind: "module", deps: [] },
          },
        ],
        subtotalCents: 415_833,
        taxCents: 83_167,
        shippingCents: 0,
        totalCents: 499_000,
      }),
    );
    prisma.checkoutIntent.findFirst.mockResolvedValue({
      status: "succeeded",
      cartJson: { branchId: undefined },
      amountCents: 499_000,
    });

    await svc.confirmAndProvision(TENANT, {} as any, PAYMENT_REF);

    const codes = tenantMarketplace.purchase.mock.calls.map(
      (c: any[]) => c[1].addOnCode,
    );
    expect(codes).toEqual(["module_personnel", "module_personnel_card_shift"]);
  });
});
