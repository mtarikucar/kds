import { ConflictException } from "@nestjs/common";
import { CheckoutIntentService } from "./checkout-intent.service";
import { Cart, CartQuote } from "./checkout.types";

/**
 * Task 4 — exploit tests for the tahsilat-önü (pre-payment) hardware stock
 * guard (Donanım #1).
 *
 * DEFECT (pre-fix): CatalogService.allocate() — the only place stock was
 * ever checked — runs inside CheckoutService.confirmAndProvision, which
 * only executes AFTER PayTR has already settled the charge. The seed
 * creates every hardwareInventory row at the schema default (available=0)
 * while each HardwareProduct carries a hand-written stockStatus:"in_stock",
 * so a buyer could see "in stock", pay in full, and only then discover
 * provisioning fails with "Insufficient stock" — money charged, nothing
 * delivered, no refund rail.
 *
 * These tests wire a REAL CheckoutIntentService with a mocked
 * CatalogService.getAvailableStock and assert the exploit is closed at the
 * createIntent boundary: for every out-of-stock hardware line,
 * `prisma.checkoutIntent.create` and `payments.createIntent` must NEVER be
 * called — no row, no gateway call, no money in flight. allocate() itself
 * stays untouched in confirmAndProvision as the transactional, race-safe
 * reservation; this is a cheap pre-payment read, not a replacement for it.
 */
describe("CheckoutIntentService.createIntent — hardware stock guard (Task 4)", () => {
  let prisma: any;
  let payments: any;
  let quoteSvc: any;
  let addonGuard: any;
  let catalog: { getAvailableStock: jest.Mock };
  let svc: CheckoutIntentService;

  const buyer = {
    email: "buyer@example.com",
    name: "Test Buyer",
    phone: "+905551234567",
  };

  beforeEach(() => {
    prisma = {
      checkoutIntent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    payments = {
      createIntent: jest.fn().mockResolvedValue({
        providerId: "paytr",
        intentId: "CK-xxx",
        status: "pending",
        amountCents: 0,
        currency: "TRY",
        clientAction: { iframeToken: "tok", paymentLink: "https://pay.test/x" },
      }),
    };
    quoteSvc = { quote: jest.fn() };
    addonGuard = { assertPurchasable: jest.fn().mockResolvedValue(undefined) };
    catalog = { getAvailableStock: jest.fn() };
    svc = new CheckoutIntentService(
      prisma,
      quoteSvc,
      payments,
      addonGuard,
      catalog as any,
    );
  });

  function hardwareCart(sku: string, qty: number): Cart {
    return { items: [{ type: "hardware", sku, qty }] };
  }

  function hardwareQuote(qty: number, productId = "p-1"): CartQuote {
    return {
      lines: [
        {
          type: "hardware",
          code: "yazarkasa-hugin-tiger-t300",
          name: "Yazarkasa Hugin Tiger T300",
          qty,
          unitCents: 50000,
          subtotalCents: 50000 * qty,
          cadence: "oneTime",
          meta: { productId, acquisition: "sell" },
        },
      ],
      currency: "TRY",
      subtotalCents: (50000 * qty * 5) / 6,
      taxCents: (50000 * qty) / 6,
      shippingCents: 5000,
      totalCents: 50000 * qty + 5000,
      warnings: [],
      isPureRecurring: false,
    };
  }

  it("rejects with HARDWARE_OUT_OF_STOCK when available < qty — no intent row, no gateway call", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote(5));
    catalog.getAvailableStock.mockResolvedValue(2); // only 2 on hand, buyer wants 5

    let threw = false;
    try {
      await svc.createIntent({
        tenantId: "t-1",
        cart: hardwareCart("yazarkasa-hugin-tiger-t300", 5),
        buyer,
        buyerIp: "1.2.3.4",
      });
    } catch (e: any) {
      threw = true;
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe("HARDWARE_OUT_OF_STOCK");
    }
    expect(threw).toBe(true);
    // The money-integrity assertion: NOTHING downstream ran.
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  it("rejects when stock is exactly 0 (the seed's pre-fix default)", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote(1));
    catalog.getAvailableStock.mockResolvedValue(0);

    await expect(
      svc.createIntent({
        tenantId: "t-1",
        cart: hardwareCart("yazarkasa-hugin-tiger-t300", 1),
        buyer,
        buyerIp: "1.2.3.4",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  it("checks stock BEFORE calling allocate/checkoutIntent.create — the gate runs pre-payment, not post", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote(3));
    catalog.getAvailableStock.mockResolvedValue(1);

    await expect(
      svc.createIntent({
        tenantId: "t-1",
        cart: hardwareCart("yazarkasa-hugin-tiger-t300", 3),
        buyer,
        buyerIp: "1.2.3.4",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(catalog.getAvailableStock).toHaveBeenCalledWith("p-1");
  });

  it("passes through with sufficient stock (available === qty, exact match)", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote(2));
    catalog.getAvailableStock.mockResolvedValue(2);

    await expect(
      svc.createIntent({
        tenantId: "t-1",
        cart: hardwareCart("yazarkasa-hugin-tiger-t300", 2),
        buyer,
        buyerIp: "1.2.3.4",
      }),
    ).resolves.toBeDefined();
    expect(prisma.checkoutIntent.create).toHaveBeenCalledTimes(1);
    expect(payments.createIntent).toHaveBeenCalledTimes(1);
  });

  it("passes through with abundant stock", async () => {
    quoteSvc.quote.mockResolvedValue(hardwareQuote(1));
    catalog.getAvailableStock.mockResolvedValue(25);

    await expect(
      svc.createIntent({
        tenantId: "t-1",
        cart: hardwareCart("yazarkasa-hugin-tiger-t300", 1),
        buyer,
        buyerIp: "1.2.3.4",
      }),
    ).resolves.toBeDefined();
    expect(prisma.checkoutIntent.create).toHaveBeenCalledTimes(1);
  });

  it("checks EVERY hardware line in a multi-line cart — first out-of-stock line wins, still nothing downstream", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "hardware",
          code: "sku-a",
          name: "Product A",
          qty: 1,
          unitCents: 10000,
          subtotalCents: 10000,
          cadence: "oneTime",
          meta: { productId: "p-a", acquisition: "sell" },
        },
        {
          type: "hardware",
          code: "sku-b",
          name: "Product B",
          qty: 10,
          unitCents: 5000,
          subtotalCents: 50000,
          cadence: "oneTime",
          meta: { productId: "p-b", acquisition: "sell" },
        },
      ],
      currency: "TRY",
      subtotalCents: 50000,
      taxCents: 10000,
      shippingCents: 5000,
      totalCents: 65000,
      warnings: [],
      isPureRecurring: false,
    } as CartQuote);
    catalog.getAvailableStock.mockImplementation(async (productId: string) =>
      productId === "p-a" ? 5 : 1, // p-a fine, p-b short (needs 10, has 1)
    );

    let threw = false;
    try {
      await svc.createIntent({
        tenantId: "t-1",
        cart: { items: [{ type: "hardware", sku: "sku-a", qty: 1 }, { type: "hardware", sku: "sku-b", qty: 10 }] },
        buyer,
        buyerIp: "1.2.3.4",
      });
    } catch (e: any) {
      threw = true;
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe("HARDWARE_OUT_OF_STOCK");
    }
    expect(threw).toBe(true);
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  it("does not call getAvailableStock for non-hardware lines (plan/addon/service untouched by this guard)", async () => {
    quoteSvc.quote.mockResolvedValue({
      lines: [
        {
          type: "addon",
          code: "advanced_reports",
          name: "Advanced reports",
          qty: 1,
          unitCents: 9900,
          subtotalCents: 9900,
          cadence: "monthly",
          meta: {},
        },
      ],
      currency: "TRY",
      subtotalCents: 8250,
      taxCents: 1650,
      shippingCents: 0,
      totalCents: 9900,
      warnings: [],
      isPureRecurring: true,
    } as CartQuote);

    await expect(
      svc.createIntent({
        tenantId: "t-1",
        cart: { items: [{ type: "addon", code: "advanced_reports" }] },
        buyer,
        buyerIp: "1.2.3.4",
      }),
    ).resolves.toBeDefined();
    expect(catalog.getAvailableStock).not.toHaveBeenCalled();
    expect(prisma.checkoutIntent.create).toHaveBeenCalledTimes(1);
  });
});
