import { describe, it, expect } from 'vitest';
import {
  deriveE164,
  getFlagEmoji,
  countryDialCode,
  splitE164,
} from './phoneInputLogic';

describe('phoneInputLogic', () => {
  describe('deriveE164', () => {
    it.each([
      ['0555 123 45 67', 'TR', '+905551234567'],
      ['5551234567', 'TR', '+905551234567'],
      ['(0555) 123-45-67', 'TR', '+905551234567'],
      ['+90 555 123 45 67', 'TR', '+905551234567'],
    ])('normalizes %p (region %s) to %p', (input, region, expected) => {
      expect(deriveE164(input, region as any)).toBe(expected);
    });

    it('returns empty string for an incomplete/invalid number', () => {
      expect(deriveE164('123', 'TR')).toBe('');
      expect(deriveE164('', 'TR')).toBe('');
    });
  });

  describe('splitE164', () => {
    it('splits a valid E.164 into country + national number', () => {
      expect(splitE164('+905551234567')).toEqual({ country: 'TR', nationalNumber: '5551234567' });
      expect(splitE164('+12025550182')).toEqual({ country: 'US', nationalNumber: '2025550182' });
    });

    it('returns null for empty/unparseable input', () => {
      expect(splitE164('')).toBeNull();
      expect(splitE164('garbage')).toBeNull();
    });
  });

  describe('getFlagEmoji', () => {
    it('maps an ISO country code to its flag emoji', () => {
      expect(getFlagEmoji('TR')).toBe('🇹🇷');
      expect(getFlagEmoji('US')).toBe('🇺🇸');
    });
  });

  describe('countryDialCode', () => {
    it('returns the international dialing code', () => {
      expect(countryDialCode('TR')).toBe('90');
      expect(countryDialCode('US')).toBe('1');
    });
  });
});
