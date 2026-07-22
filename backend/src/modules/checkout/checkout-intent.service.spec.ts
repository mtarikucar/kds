import { BadRequestException } from '@nestjs/common';
import { CheckoutIntentService } from './checkout-intent.service';
import { Cart, CartQuote } from './checkout.types';

/**
 * v2.8.85 — CheckoutIntentService.
 *
 * The service:
 *   1. Re-prices the cart server-side (don't trust client totals).
 *   2. Mints a CK- prefix paymentRef per call.
 *   3. Persists a CheckoutIntent row BEFORE calling PayTR so the
 *      asynchronous webhook callback can recover the cart.
 *   4. Builds a multi-line PayTR basket from the priced lines. Basket
 *      sum MUST equal amountCents — PayTR rejects mismatched baskets and
 *      iter-90 wired the verify, so a basket-sum drift would surface as
 *      a noisy 400 instead of silent over/undercharging.
 *   5. Refuses cart total = 0 (PayTR rejects amount=0; the admin-comp
 *      path is the right tool for free provisioning).
 */
describe('CheckoutIntentService (v2.8.85)', () => {
  let prisma: any;
  let payments: any;
  let quoteSvc: any;
  let addonGuard: any;
  let svc: CheckoutIntentService;

  beforeEach(() => {
    prisma = {
      checkoutIntent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    payments = {
      createIntent: jest.fn().mockResolvedValue({
        providerId: 'paytr',
        intentId: 'CK-xxx',
        status: 'pending',
        amountCents: 0,
        currency: 'TRY',
        clientAction: { iframeToken: 'tok-123', paymentLink: 'https://pay.test/x' },
      }),
    };
    quoteSvc = {
      quote: jest.fn(),
    };
    // None of these fixtures put an `addon` line in the cart, so the guard
    // is never invoked here — dedicated coverage lives in
    // checkout-intent.addon-guard.spec.ts. Still wired so the constructor
    // shape matches production DI.
    addonGuard = {
      assertPurchasable: jest.fn().mockResolvedValue(undefined),
    };
    svc = new CheckoutIntentService(prisma, quoteSvc, payments, addonGuard);
  });

  function mockQuote(overrides: Partial<CartQuote> = {}): CartQuote {
    return {
      lines: [
        {
          type: 'hardware',
          code: 'yazarkasa-hugin-tiger-t300',
          name: 'Yazarkasa Hugin Tiger T300',
          qty: 2,
          unitCents: 50000,
          subtotalCents: 100000,
          cadence: 'oneTime',
          meta: { productId: 'p-1', acquisition: 'sell' },
        },
        {
          type: 'plan',
          code: 'PRO',
          name: 'Pro Plan',
          qty: 1,
          unitCents: 19900,
          subtotalCents: 19900,
          cadence: 'yearly',
          meta: { planId: 'pl-1', billingCycle: 'YEARLY' },
        },
      ],
      currency: 'TRY',
      subtotalCents: 119900,
      taxCents: 23980, // 20% KDV
      shippingCents: 5000,
      totalCents: 148880,
      warnings: [],
      isPureRecurring: false,
      ...overrides,
    };
  }

  function dummyCart(): Cart {
    return {
      items: [
        { type: 'hardware', sku: 'yazarkasa-hugin-tiger-t300', qty: 2 },
        { type: 'plan', code: 'PRO', billingCycle: 'YEARLY' },
      ],
    };
  }

  const buyer = {
    email: 'buyer@example.com',
    name: 'Test Buyer',
    phone: '+905551234567',
  };

  it('persists a CheckoutIntent row BEFORE calling the payments facade (so the webhook always has something to recover)', async () => {
    quoteSvc.quote.mockResolvedValue(mockQuote());
    const callOrder: string[] = [];
    prisma.checkoutIntent.create.mockImplementation(async () => {
      callOrder.push('prisma');
    });
    payments.createIntent.mockImplementation(async () => {
      callOrder.push('payments');
      return {
        providerId: 'paytr',
        intentId: 'x',
        status: 'pending',
        amountCents: 0,
        currency: 'TRY',
        clientAction: { iframeToken: 'tok', paymentLink: 'url' },
      };
    });

    await svc.createIntent({
      tenantId: 't-1',
      cart: dummyCart(),
      buyer,
      buyerIp: '1.2.3.4',
    });

    expect(callOrder).toEqual(['prisma', 'payments']);
  });

  it('mints a paymentRef with the "CK-" prefix and persists it on the intent row', async () => {
    quoteSvc.quote.mockResolvedValue(mockQuote());
    const out = await svc.createIntent({
      tenantId: 't-1',
      cart: dummyCart(),
      buyer,
      buyerIp: '1.2.3.4',
    });
    expect(out.paymentRef).toMatch(/^CK-/);
    const persisted = prisma.checkoutIntent.create.mock.calls[0][0].data;
    expect(persisted.paymentRef).toBe(out.paymentRef);
    expect(persisted.tenantId).toBe('t-1');
    expect(persisted.status).toBe('pending');
    expect(persisted.amountCents).toBe(148880);
    expect(persisted.providerId).toBe('paytr');
  });

  it('refuses a cart that prices to 0 (PayTR rejects amount=0; admin-comp is the right path)', async () => {
    quoteSvc.quote.mockResolvedValue(
      mockQuote({ lines: [], subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0 }),
    );
    await expect(
      svc.createIntent({
        tenantId: 't-1',
        cart: dummyCart(),
        buyer,
        buyerIp: '1.2.3.4',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.checkoutIntent.create).not.toHaveBeenCalled();
    expect(payments.createIntent).not.toHaveBeenCalled();
  });

  it('builds a PayTR basket whose sum exactly equals amountCents (no rounding drift across multi-line carts)', async () => {
    quoteSvc.quote.mockResolvedValue(mockQuote());
    await svc.createIntent({
      tenantId: 't-1',
      cart: dummyCart(),
      buyer,
      buyerIp: '1.2.3.4',
    });
    const call = payments.createIntent.mock.calls[0];
    const intentReq = call[1];
    expect(intentReq.basket).toBeDefined();
    const basketSum = intentReq.basket.reduce(
      (acc: number, line: { priceCents: number; qty: number }) => acc + line.priceCents * line.qty,
      0,
    );
    // Sum must equal the total — the PayTR adapter rejects basket
    // mismatches and we don't want surprises at the iframe screen.
    expect(basketSum).toBe(intentReq.amountCents);
    expect(basketSum).toBe(148880);
  });

  it('encodes qty into the line name when qty > 1 so the buyer sees "Product x2" on the PayTR screen', async () => {
    quoteSvc.quote.mockResolvedValue(mockQuote());
    await svc.createIntent({
      tenantId: 't-1',
      cart: dummyCart(),
      buyer,
      buyerIp: '1.2.3.4',
    });
    const basket = payments.createIntent.mock.calls[0][1].basket;
    // First line: hardware qty=2 — name should carry " x2".
    expect(basket[0].name).toContain('x2');
    expect(basket[0].qty).toBe(1); // collapsed to single-row for sum safety
    // Second line: yearly plan, no qty suffix.
    expect(basket[1].name).toContain('yıllık');
    expect(basket[1].name).not.toContain('x1');
  });

  it('handles a single-line cart cleanly (no overhead distribution needed)', async () => {
    quoteSvc.quote.mockResolvedValue(
      mockQuote({
        lines: [
          {
            type: 'addon',
            code: 'extra-kds-screen',
            name: 'Extra KDS Screen',
            qty: 1,
            unitCents: 5000,
            subtotalCents: 5000,
            cadence: 'monthly',
            meta: {},
          },
        ],
        subtotalCents: 5000,
        taxCents: 1000,
        shippingCents: 0,
        totalCents: 6000,
      }),
    );
    await svc.createIntent({
      tenantId: 't-1',
      cart: dummyCart(),
      buyer,
      buyerIp: '1.2.3.4',
    });
    const basket = payments.createIntent.mock.calls[0][1].basket;
    expect(basket).toHaveLength(1);
    expect(basket[0].priceCents).toBe(6000);
  });
});
