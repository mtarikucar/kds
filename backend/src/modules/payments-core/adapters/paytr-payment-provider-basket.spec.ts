import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaytrPaymentProvider } from './paytr-payment-provider';
import { PaymentProviderRegistry } from '../payment-provider.registry';

/**
 * v2.8.85 — multi-line PayTR basket in createIntent.
 *
 * Pre-v2.8.85 createIntent did
 *
 *   userBasket: [[req.purpose, String(req.amountCents / 100), 1]],
 *
 * regardless of cart shape. For a mixed cart (e.g. PRO plan + yazarkasa +
 * KDS screen) the buyer saw a single opaque "mixed-cart-checkout" line at
 * the PayTR iframe — eroding trust at the highest-stakes screen of the
 * funnel. v2.8.85 surfaces a basket on the PaymentIntentRequest and
 * forwards each entry verbatim; we also guard the sum so a mis-priced
 * basket fails noisily in our code rather than as a PayTR 400.
 */
describe('PaytrPaymentProvider.createIntent basket (v2.8.85)', () => {
  let provider: PaytrPaymentProvider;
  let paytrAdapter: any;
  let config: ConfigService;

  beforeEach(() => {
    const registry = new PaymentProviderRegistry();
    paytrAdapter = {
      getIframeToken: jest.fn().mockResolvedValue({
        merchantOid: 'CK-x',
        token: 'tok',
        paymentLink: 'https://pay.test/x',
        amount: '0',
        currency: 'TL',
      }),
    };
    config = { get: jest.fn() } as unknown as ConfigService;
    provider = new PaytrPaymentProvider(registry, paytrAdapter, config);
  });

  function intentReq(overrides: any = {}) {
    return {
      tenantId: 't-1',
      externalRef: 'CK-test-1',
      idempotencyKey: 'idem-1',
      amountCents: 148880,
      currency: 'TRY',
      purpose: 'mixed-cart-checkout',
      buyer: {
        email: 'b@example.com',
        name: 'Buyer',
        phone: '+905551234567',
      },
      buyerIp: '1.2.3.4',
      ...overrides,
    };
  }

  it('forwards the multi-line basket verbatim to the PayTR adapter (each cart line shows on the iframe)', async () => {
    await provider.createIntent(
      intentReq({
        basket: [
          { name: 'Yazarkasa x2', priceCents: 120000, qty: 1 },
          { name: 'Pro Plan (yıllık)', priceCents: 28880, qty: 1 },
        ],
      }),
    );
    const call = paytrAdapter.getIframeToken.mock.calls[0][0];
    expect(call.userBasket).toEqual([
      ['Yazarkasa x2', '1200.00', 1],
      ['Pro Plan (yıllık)', '288.80', 1],
    ]);
  });

  it('throws BadRequest when the basket sum does NOT equal amountCents (catches repricing drift before PayTR does)', async () => {
    await expect(
      provider.createIntent(
        intentReq({
          amountCents: 100000,
          basket: [
            { name: 'A', priceCents: 50000, qty: 1 },
            { name: 'B', priceCents: 30000, qty: 1 }, // sum=80000, not 100000
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falls back to a single-line basket when none is supplied (backwards-compatible with subscription path)', async () => {
    await provider.createIntent(intentReq({ amountCents: 19900 }));
    const call = paytrAdapter.getIframeToken.mock.calls[0][0];
    expect(call.userBasket).toEqual([['mixed-cart-checkout', '199.00', 1]]);
  });

  it('strips control chars and caps line names at 80 chars before handing to PayTR', async () => {
    const longName = 'a'.repeat(200);
    await provider.createIntent(
      intentReq({
        amountCents: 10000,
        basket: [{ name: `bad\r\n${longName}`, priceCents: 10000, qty: 1 }],
      }),
    );
    const sentName = paytrAdapter.getIframeToken.mock.calls[0][0].userBasket[0][0];
    expect(sentName).not.toContain('\r');
    expect(sentName).not.toContain('\n');
    expect(sentName.length).toBeLessThanOrEqual(80);
  });
});
