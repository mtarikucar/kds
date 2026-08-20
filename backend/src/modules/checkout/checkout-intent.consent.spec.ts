import { BadRequestException } from "@nestjs/common";
import { CheckoutIntentService } from "./checkout-intent.service";
import { Cart } from "./checkout.types";

/**
 * Distance-selling consent on the à-la-carte rail.
 *
 * Turkish distance selling requires the buyer to accept KVKK, the Mesafeli
 * Satış Sözleşmesi and the İade Politikası before payment, and the retired
 * `/payments/create-intent` enforced exactly that: three current document ids,
 * verified and written as audit rows carrying the IP and user-agent, before a
 * PayTR token existed. Moving purchasing to the cart rail left the obligation
 * in place and the enforcement behind — for a while every à-la-carte sale took
 * money with no record the terms had ever been shown.
 *
 * The properties this pins: consent is verified BEFORE the gateway is called,
 * a rejection stops the whole flow (no intent row, no token), and the audit
 * context carries who/where rather than just "someone agreed".
 */
const referralDirectory = {
  resolveReferralCode: jest.fn().mockResolvedValue(null),
};

const DOCS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

describe("CheckoutIntentService.createIntent legal consent", () => {
  let prisma: any;
  let payments: any;
  let quoteSvc: any;
  let addonGuard: any;
  let catalog: any;
  let demoGuard: { assertNotDemo: jest.Mock };
  let consent: { verifyAndRecord: jest.Mock };
  let countryCapability: { paymentProviderFor: jest.Mock };
  let svc: CheckoutIntentService;

  beforeEach(() => {
    prisma = { checkoutIntent: { create: jest.fn().mockResolvedValue({}) } };
    payments = {
      createIntent: jest
        .fn()
        .mockResolvedValue({ paymentLink: "https://paytr.test/x", raw: {} }),
    };
    quoteSvc = {
      quote: jest.fn().mockResolvedValue({
        lines: [
          {
            type: "addon",
            code: "module_personnel",
            name: "Personel",
            qty: 1,
            unitCents: 99_000,
            subtotalCents: 99_000,
            cadence: "yearly",
            meta: {},
          },
        ],
        subtotalCents: 82_500,
        taxCents: 16_500,
        shippingCents: 0,
        totalCents: 99_000,
        currency: "TRY",
        warnings: [],
        isPureRecurring: true,
      }),
    };
    addonGuard = { assertPurchasable: jest.fn() };
    catalog = { getAvailableStock: jest.fn() };
    demoGuard = { assertNotDemo: jest.fn().mockResolvedValue(undefined) };
    consent = { verifyAndRecord: jest.fn().mockResolvedValue(undefined) };
    countryCapability = {
      paymentProviderFor: jest.fn().mockResolvedValue({ id: "paytr" }),
    };
    svc = new CheckoutIntentService(
      prisma,
      quoteSvc,
      payments,
      addonGuard,
      catalog,
      referralDirectory as any,
      countryCapability as any,
      demoGuard as any,
      consent as any,
    );
  });

  const cart = (): Cart =>
    ({ items: [{ type: "addon", code: "module_personnel", qty: 1 }] }) as any;

  const call = (over: Record<string, unknown> = {}) =>
    svc.createIntent({
      tenantId: "t-1",
      cart: cart(),
      buyer: {
        email: "a@b.com",
        name: "Ada",
        phone: "+905551112233",
      } as any,
      buyerIp: "203.0.113.7",
      userId: "u-1",
      userAgent: "Mozilla/5.0",
      acceptedDocumentIds: DOCS,
      ...over,
    });

  it("records consent with the buyer, the IP and the user-agent", async () => {
    await call();
    expect(consent.verifyAndRecord).toHaveBeenCalledWith(DOCS, {
      userId: "u-1",
      ipAddress: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });
  });

  it("records consent BEFORE the payment gateway is called", async () => {
    const order: string[] = [];
    consent.verifyAndRecord.mockImplementation(async () => {
      order.push("consent");
    });
    payments.createIntent.mockImplementation(async () => {
      order.push("paytr");
      return { paymentLink: "https://paytr.test/x", raw: {} };
    });

    await call();
    expect(order).toEqual(["consent", "paytr"]);
  });

  it("aborts the whole checkout when consent is missing — no intent row, no token", async () => {
    // The failure mode this prevents: a buyer charged for a purchase whose
    // terms were never recorded, with an intent row implying otherwise.
    consent.verifyAndRecord.mockRejectedValue(
      new BadRequestException("Devam etmek için tüm yasal belgeleri onaylamanız gerekiyor."),
    );

    await expect(call({ acceptedDocumentIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  it("rejects before pricing, so a stale document version cannot be paid against", async () => {
    consent.verifyAndRecord.mockRejectedValue(
      new BadRequestException("Yasal belge güncellendi."),
    );
    await expect(call()).rejects.toThrow(/güncellendi/);
    expect(quoteSvc.quote).not.toHaveBeenCalled();
  });

  it("skips consent for a server-initiated intent with no user behind it", async () => {
    // Renewal jobs and other machine callers have no human to record consent
    // against; requiring it there would block the renewal rather than protect
    // anybody. Only the authenticated HTTP path passes a userId.
    await call({ userId: undefined });
    expect(consent.verifyAndRecord).not.toHaveBeenCalled();
    expect(payments.createIntent).toHaveBeenCalled();
  });
});
