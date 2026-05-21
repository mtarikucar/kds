import {
  buildIframeTokenSignature,
  buildRecurringPaymentSignature,
  buildRefundSignature,
  buildInquirySignature,
  buildRecurringCancelSignature,
  buildBinDetailSignature,
  buildInstallmentTableSignature,
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

  describe('buildRefundSignature', () => {
    it('matches HMAC over merchant_id + merchant_oid + return_amount + salt', () => {
      const sig = buildRefundSignature(
        { merchantId: '123456', merchantOid: 'ABC123', returnAmount: '5000' },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );
      expect(sig).toBe('JFR7mfpwbNJFbZpWfCPVn10o6Pqul9GTBABZ3ti25ic=');
    });
  });

  describe('buildInquirySignature', () => {
    it('matches HMAC over merchant_id + merchant_oid + salt', () => {
      const sig = buildInquirySignature(
        { merchantId: '123456', merchantOid: 'ABC123' },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );
      expect(sig).toBe('QOGXQcEsbYZC+guX+/u1e+q+7FPQYeOV7Yf6hotRsog=');
    });
  });

  describe('buildRecurringCancelSignature', () => {
    it('matches HMAC over merchant_id + utoken + salt', () => {
      const sig = buildRecurringCancelSignature(
        { merchantId: '123456', utoken: 'tk_abc' },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );
      expect(sig).toBe('R0DJ5Hb9PmkSLOlDq19bk1WFRZ8/eBXjtxoEcf2eBEI=');
    });
  });

  describe('buildBinDetailSignature', () => {
    it('matches HMAC over merchant_id + bin_number + salt', () => {
      const sig = buildBinDetailSignature(
        { merchantId: '123456', binNumber: '454671' },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );
      expect(sig).toBe('cQ1W5CcvbGrClhxLgrwv8rg9FwNiPhkShDYE58WWolg=');
    });
  });

  describe('buildInstallmentTableSignature', () => {
    it('matches HMAC over merchant_id + amount + salt', () => {
      const sig = buildInstallmentTableSignature(
        { merchantId: '123456', amount: '29999' },
        { merchantKey: 'key_x', merchantSalt: 'salt_x' },
      );
      expect(sig).toBe('ufVvquJUQevOP9N7Y9yujDEG/tc2mPXqEeRKaa5A3yw=');
    });
  });
});
