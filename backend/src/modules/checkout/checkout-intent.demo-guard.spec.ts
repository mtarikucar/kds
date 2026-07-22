import { ForbiddenException } from "@nestjs/common";
import { CheckoutIntentService } from "./checkout-intent.service";
import { Cart } from "./checkout.types";

/**
 * Task D1 — demo-account payment block. CheckoutIntentService.createIntent
 * (marketplace add-ons + hardware store PayTR intent) must reject the
 * shared "explore demo" tenant with 403 DEMO_PAYMENT_BLOCKED BEFORE the
 * addon-purchasability / hardware-stock checks or the re-price/PayTR call.
 * DemoGuardService is mocked here to keep this spec unit-scoped.
 */
describe("CheckoutIntentService.createIntent demo-tenant block", () => {
  let prisma: any;
  let payments: any;
  let quoteSvc: any;
  let addonGuard: any;
  let catalog: any;
  let demoGuard: { assertNotDemo: jest.Mock };
  let svc: CheckoutIntentService;

  beforeEach(() => {
    prisma = { checkoutIntent: { create: jest.fn() } };
    payments = { createIntent: jest.fn() };
    quoteSvc = { quote: jest.fn() };
    addonGuard = { assertPurchasable: jest.fn() };
    catalog = { getAvailableStock: jest.fn() };
    demoGuard = {
      assertNotDemo: jest.fn().mockRejectedValue(
        new ForbiddenException({
          statusCode: 403,
          error: "Demo Payment Blocked",
          errorCode: "DEMO_PAYMENT_BLOCKED",
          message: "Demo modunda ödeme alınamaz.",
        }),
      ),
    };
    svc = new CheckoutIntentService(
      prisma,
      quoteSvc,
      payments,
      addonGuard,
      catalog,
      demoGuard as any,
    );
  });

  function dummyCart(): Cart {
    return {
      items: [
        { type: "hardware", productId: "p-1", qty: 1, acquisition: "sell" },
      ],
    } as any;
  }

  it("rejects with 403 DEMO_PAYMENT_BLOCKED before pricing the cart or calling PayTR", async () => {
    await expect(
      svc.createIntent({
        tenantId: "tenant-demo",
        cart: dummyCart(),
        buyer: { email: "a@b.com", name: "A", phone: "+905551234567", address: "x" } as any,
        buyerIp: "127.0.0.1",
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: "DEMO_PAYMENT_BLOCKED" }),
    });

    expect(demoGuard.assertNotDemo).toHaveBeenCalledWith("tenant-demo");
    expect(addonGuard.assertPurchasable).not.toHaveBeenCalled();
    expect(quoteSvc.quote).not.toHaveBeenCalled();
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException", async () => {
    await expect(
      svc.createIntent({
        tenantId: "tenant-demo",
        cart: dummyCart(),
        buyer: { email: "a@b.com", name: "A", phone: "+905551234567", address: "x" } as any,
        buyerIp: "127.0.0.1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
