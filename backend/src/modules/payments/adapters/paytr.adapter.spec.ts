import {
  buildIframeTokenSignature,
  buildRecurringPaymentSignature,
  buildPaymentUrl,
  encodeUserBasket,
  amountToKurus,
} from './paytr.adapter';

describe('PayTR adapter primitives', () => {
  describe('amountToKurus', () => {
    it('converts 299.99 TRY to "29999"', () => {
      expect(amountToKurus(299.99)).toBe('29999');
    });

    it('converts 1 to "100"', () => {
      expect(amountToKurus(1)).toBe('100');
    });

    it('rounds half-up at the second decimal', () => {
      // 1.005 → 100.5 kuruş → 101
      expect(amountToKurus(1.005)).toBe('101');
    });

    it('handles zero', () => {
      expect(amountToKurus(0)).toBe('0');
    });

    it('accepts string input', () => {
      expect(amountToKurus('19.99')).toBe('1999');
    });

    it('throws on negative amounts', () => {
      expect(() => amountToKurus(-1)).toThrow();
    });
  });

  describe('encodeUserBasket', () => {
    it('JSON-encodes then base64-encodes a basket', () => {
      const basket: Array<[string, string, number]> = [
        ['Pro Plan (Monthly)', '299.99', 1],
      ];
      const encoded = encodeUserBasket(basket);
      const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8'));
      expect(decoded).toEqual(basket);
    });
  });

  describe('buildIframeTokenSignature', () => {
    it('matches the documented HMAC over the concatenated payload + salt', () => {
      const sig = buildIframeTokenSignature(
        {
          merchantId: '123456',
          userIp: '127.0.0.1',
          merchantOid: 'ABC123',
          email: 'user@example.com',
          paymentAmount: '10000',
          userBasketBase64: 'W1tcImEiLDEsMV1d',
          noInstallment: '0',
          maxInstallment: '0',
          currency: 'TL',
          testMode: '1',
        },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );

      expect(sig).toBe('BL2US8r/NRPIt/T1YU6tMHPrT/O5XZomA5N+79ZkM8s=');
    });
  });

  describe('buildRecurringPaymentSignature', () => {
    it('matches HMAC over merchant_id + utoken + total + currency + merchant_oid + salt', () => {
      const sig = buildRecurringPaymentSignature(
        {
          merchantId: '123456',
          utoken: 'tk_abc',
          total: '29999',
          currency: 'TL',
          merchantOid: 'REC-1',
        },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );

      expect(sig).toBe('9SdRR1xh0Znp5u5Z2E+WOaVyGZMVsZw4DPJHf90Av9I=');
    });
  });

  describe('buildPaymentUrl', () => {
    it('builds the secure-payment URL from a token', () => {
      expect(buildPaymentUrl('tk_xyz')).toBe('https://www.paytr.com/odeme/guvenli/tk_xyz');
    });
  });
});
