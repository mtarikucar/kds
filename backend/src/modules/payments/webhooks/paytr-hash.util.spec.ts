import { computeCallbackHash, verifyCallbackHash } from './paytr-hash.util';

describe('PayTR callback hash', () => {
  describe('computeCallbackHash', () => {
    it('produces the documented HMAC-SHA256 base64 digest', () => {
      // Frozen fixture computed once against the PayTR-documented formula:
      //   HMAC-SHA256(merchantKey, merchantOid + merchantSalt + status + totalAmount).base64()
      const hash = computeCallbackHash({
        merchantOid: 'SUB-abc-1',
        merchantSalt: 'salt_x',
        status: 'success',
        totalAmount: '29999',
        merchantKey: 'key_x',
      });

      expect(hash).toBe('9A6csV2PNILM+7Rj0OkK6tjaRT4YhocCCxIvqWfrpJE=');
    });

    it('changes when any input changes (failed status)', () => {
      const hash = computeCallbackHash({
        merchantOid: 'SUB-abc-2',
        merchantSalt: 'salt_x',
        status: 'failed',
        totalAmount: '0',
        merchantKey: 'key_x',
      });

      expect(hash).toBe('i2b/RE5sG41aD0YMM6i6XqBJiSX7DG7fYaabn0vb9wE=');
    });
  });

  describe('verifyCallbackHash', () => {
    const valid = {
      merchantOid: 'SUB-abc-1',
      merchantSalt: 'salt_x',
      status: 'success',
      totalAmount: '29999',
      merchantKey: 'key_x',
      providedHash: '9A6csV2PNILM+7Rj0OkK6tjaRT4YhocCCxIvqWfrpJE=',
    };

    it('returns true for the matching hash', () => {
      expect(verifyCallbackHash(valid)).toBe(true);
    });

    it('returns false when the provided hash is wrong', () => {
      expect(verifyCallbackHash({ ...valid, providedHash: 'tampered' })).toBe(false);
    });

    it('returns false when status differs from what was signed', () => {
      expect(verifyCallbackHash({ ...valid, status: 'failed' })).toBe(false);
    });

    it('returns false when the provided hash is empty', () => {
      expect(verifyCallbackHash({ ...valid, providedHash: '' })).toBe(false);
    });

    it('uses constant-time comparison (does not throw on length mismatch)', () => {
      expect(() =>
        verifyCallbackHash({ ...valid, providedHash: 'short' }),
      ).not.toThrow();
      expect(verifyCallbackHash({ ...valid, providedHash: 'short' })).toBe(false);
    });
  });
});
