import {
  generateReferralCode,
  generateFallbackReferralCode,
  isValidReferralCodeFormat,
  normalizeReferralCode,
} from './referral-code';

describe('referral-code utility', () => {
  describe('generateReferralCode', () => {
    it('uses the first three ASCII letters of the name as prefix', () => {
      const code = generateReferralCode('Mehmet');
      expect(code.slice(0, 3)).toBe('MEH');
      expect(code).toHaveLength(7);
    });

    it('normalises Turkish characters in the prefix', () => {
      const code = generateReferralCode('Şükrü');
      expect(code.slice(0, 3)).toBe('SUK');
    });

    it('falls back to MKT prefix when name has fewer than three letters', () => {
      const code = generateReferralCode('Al'); // 2 letters
      expect(code.slice(0, 3)).toBe('MKT');
      expect(code).toHaveLength(7);
    });

    it('uses only the restricted alphabet (no 0/1/I/O/L)', () => {
      // 200 samples to catch any pathological character leak.
      for (let i = 0; i < 200; i++) {
        const code = generateReferralCode('Ayşe');
        expect(code).toMatch(/^[A-Z2-9]+$/);
        expect(code).not.toMatch(/[01ILO]/);
      }
    });

    it('produces distinct suffixes on rapid successive calls', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) seen.add(generateReferralCode('Ahmet'));
      // Allow rare collisions on a 4-char suffix from a 31-char alphabet
      // (≈923k combinations) — but the vast majority must be unique.
      expect(seen.size).toBeGreaterThanOrEqual(48);
    });
  });

  describe('generateFallbackReferralCode', () => {
    it('uses MKT prefix and 6 random chars', () => {
      const code = generateFallbackReferralCode();
      expect(code.startsWith('MKT')).toBe(true);
      expect(code).toHaveLength(9);
      expect(code).toMatch(/^MKT[A-Z2-9]{6}$/);
    });
  });

  describe('isValidReferralCodeFormat', () => {
    it.each([
      ['AHMET42', true],
      ['MKT9X3K2', true],
      ['ABC23', true], // minimum length 5
      ['ABCDEFGH2345', true], // max length 12
    ])('accepts %s', (code, expected) => {
      expect(isValidReferralCodeFormat(code)).toBe(expected);
    });

    it.each([
      ['', false],
      ['abc12', false], // lowercase
      ['AHMET0', false], // contains 0
      ['AHMET1', false], // contains 1
      ['AHME', false], // too short
      ['ABCDEFGHIJK22', false], // too long (13)
      ['AHMET-2', false], // dash
    ])('rejects %s', (code, expected) => {
      expect(isValidReferralCodeFormat(code)).toBe(expected);
    });

    it('rejects null and undefined safely', () => {
      expect(isValidReferralCodeFormat(null)).toBe(false);
      expect(isValidReferralCodeFormat(undefined)).toBe(false);
    });
  });

  describe('normalizeReferralCode', () => {
    it('trims + uppercases and returns the canonical form', () => {
      expect(normalizeReferralCode('  ahmet42  ')).toBe('AHMET42');
    });

    it('returns null for malformed codes after normalisation', () => {
      expect(normalizeReferralCode('ahmet0')).toBeNull(); // 0 not allowed
      expect(normalizeReferralCode('  ')).toBeNull();
      expect(normalizeReferralCode('')).toBeNull();
    });

    it('returns null for null/undefined input', () => {
      expect(normalizeReferralCode(null)).toBeNull();
      expect(normalizeReferralCode(undefined)).toBeNull();
    });
  });
});
