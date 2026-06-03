import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaytrAdapter } from './paytr.adapter';

/**
 * Iter-67 regression — PaytrAdapter used to hardcode `currency: "TL"`
 * on the wire while ignoring whatever currency the calling plan/order
 * was actually denominated in. A SubscriptionPlan priced in USD
 * displayed as $199 on the storefront but the adapter posted
 * `payment_amount=19900 currency=TL` to PayTR, so the customer was
 * charged 199 TL. The user reported this directly:
 *
 *   "Abonelik alma kısmında ve ödemelerde para birimi ile alakalı
 *    SORUNLAR var. 199 $ olan şeyi 199 TL olarak satın alıyor"
 *
 * The fix introduces an `input.currency` field on getIframeToken /
 * chargeRecurring + a single assertion at the adapter boundary that
 * rejects anything other than TRY/TL. Callers (PaymentsService,
 * CustomerSelfPayService, PaytrPaymentProvider) pre-check too so the
 * 400 fires before any reservation row is written, but the adapter
 * gate is the load-bearing defence — a future caller that forgets to
 * validate still can't silently mis-collect.
 */
describe('PaytrAdapter currency boundary (iter-67)', () => {
  // The adapter reads PAYTR_USE_FAKE_ADAPTER via its injected
  // ConfigService (not process.env), so the fake-token short-circuit
  // has to be wired through the mock. The "happy path" tests in this
  // suite rely on it: validating that TRY/TL pass the currency gate
  // without trying to actually hit paytr.com.
  const config = {
    get: (key: string) => {
      const env: Record<string, string> = {
        PAYTR_MERCHANT_ID: '123456',
        PAYTR_MERCHANT_KEY: 'k',
        PAYTR_MERCHANT_SALT: 's',
        PAYTR_TEST_MODE: '1',
        PAYTR_USE_FAKE_ADAPTER: 'true',
      };
      return env[key];
    },
  } as ConfigService;

  const baseInput = {
    merchantOid: 'SUB-test-001',
    amount: 199,
    email: 'buyer@example.com',
    userName: 'Buyer Name',
    userAddress: 'Türkiye',
    userPhone: '+905551112233',
    userBasket: [['Plan', '199.00', 1]] as Array<[string, string, number]>,
    userIp: '127.0.0.1',
    okUrl: 'https://example.com/ok',
    failUrl: 'https://example.com/fail',
  };

  let adapter: PaytrAdapter;

  beforeEach(() => {
    adapter = new PaytrAdapter(config);
  });

  describe('getIframeToken', () => {
    it('refuses currency=USD with a clear message (the load-bearing 199$→199TL guard)', async () => {
      await expect(
        adapter.getIframeToken({ ...baseInput, currency: 'USD' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses currency=EUR', async () => {
      await expect(
        adapter.getIframeToken({ ...baseInput, currency: 'EUR' }),
      ).rejects.toThrow(/yalnızca TRY/);
    });

    it('refuses missing/empty currency (catches a caller that forgets to pass it)', async () => {
      await expect(
        adapter.getIframeToken({ ...baseInput, currency: '' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts TRY (the canonical currency code stored on plans/orders)', async () => {
      const result = await adapter.getIframeToken({ ...baseInput, currency: 'TRY' });
      expect(result.merchantOid).toBe('SUB-test-001');
      expect(result.currency).toBe('TL');
    });

    it('also accepts TL (PayTR\'s own internal label, for callers reading from raw stored values)', async () => {
      const result = await adapter.getIframeToken({ ...baseInput, currency: 'TL' });
      expect(result.merchantOid).toBe('SUB-test-001');
    });
  });

  describe('chargeRecurring', () => {
    it('refuses currency=USD', async () => {
      await expect(
        adapter.chargeRecurring({
          merchantOid: 'REC-1',
          amount: 199,
          currency: 'USD',
          utoken: 'tk_x',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
