import { describe, it, expect } from 'vitest';
import {
  ACTIONABLE_ERRORS,
  getActionableErrorSpec,
} from './actionableErrors';

describe('actionableErrors registry', () => {
  it('maps PROFILE_PHONE_REQUIRED to a phone field fix', () => {
    const spec = getActionableErrorSpec('PROFILE_PHONE_REQUIRED');
    expect(spec).toBeDefined();
    expect(spec?.field).toBe('phone');
    expect(spec?.inputType).toBe('tel');
  });

  it('returns undefined for unknown / missing codes', () => {
    expect(getActionableErrorSpec(undefined)).toBeUndefined();
    expect(getActionableErrorSpec('SOMETHING_ELSE')).toBeUndefined();
    expect(getActionableErrorSpec('')).toBeUndefined();
  });

  it('phone validate accepts plausible numbers and rejects junk', () => {
    const v = ACTIONABLE_ERRORS.PROFILE_PHONE_REQUIRED.validate;
    expect(v('+90 555 123 45 67')).toBe(true);
    expect(v('05551234567')).toBe(true);
    expect(v('(212) 555-1234')).toBe(true);
    expect(v('')).toBe(false);
    expect(v('123')).toBe(false); // too short
    expect(v('not-a-number!!')).toBe(false);
    expect(v('x'.repeat(25))).toBe(false); // too long
  });

  it('every registered spec carries the i18n keys the modal needs', () => {
    for (const spec of Object.values(ACTIONABLE_ERRORS)) {
      expect(spec.titleKey).toMatch(/\S/);
      expect(spec.bodyKey).toMatch(/\S/);
      expect(spec.labelKey).toMatch(/\S/);
      expect(spec.invalidKey).toMatch(/\S/);
      expect(typeof spec.validate).toBe('function');
    }
  });
});
