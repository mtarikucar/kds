import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_COUNTRY_CODES,
  DEFAULT_COUNTRY_CODE,
  isSupportedCountryCode,
} from './countries';

describe('SUPPORTED_COUNTRY_CODES', () => {
  it('mirrors the backend COUNTRY_PROFILES keys (TR and UZ today)', () => {
    // Hand-mirrored — the frontend cannot import backend source (separate
    // Docker build contexts). scripts/check-contract-drift.mjs enforces
    // this stays in lockstep with backend/src/common/country/
    // country-profile.const.ts's COUNTRY_PROFILES keys.
    expect(SUPPORTED_COUNTRY_CODES).toEqual(['TR', 'UZ']);
  });

  it('DEFAULT_COUNTRY_CODE is TR, matching the backend DEFAULT_COUNTRY', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('TR');
  });
});

describe('isSupportedCountryCode', () => {
  it('accepts every code in SUPPORTED_COUNTRY_CODES', () => {
    for (const code of SUPPORTED_COUNTRY_CODES) {
      expect(isSupportedCountryCode(code)).toBe(true);
    }
  });

  it('rejects a country with no backend profile — must not silently mislead the operator', () => {
    expect(isSupportedCountryCode('US')).toBe(false);
    expect(isSupportedCountryCode('DE')).toBe(false);
  });

  it('rejects empty/undefined/null', () => {
    expect(isSupportedCountryCode('')).toBe(false);
    expect(isSupportedCountryCode(undefined)).toBe(false);
    expect(isSupportedCountryCode(null)).toBe(false);
  });
});
