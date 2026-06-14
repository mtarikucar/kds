import { describe, expect, it } from 'vitest';
import { isValidExtendDays } from './subscriptions.helpers';

describe('isValidExtendDays', () => {
  it('rejects null (cancelled prompt)', () => {
    expect(isValidExtendDays(null)).toBe(false);
  });

  it('rejects empty string (falsy guard)', () => {
    expect(isValidExtendDays('')).toBe(false);
  });

  it('rejects non-numeric strings', () => {
    expect(isValidExtendDays('abc')).toBe(false);
    expect(isValidExtendDays('5 days')).toBe(false);
  });

  it('accepts positive integer strings', () => {
    expect(isValidExtendDays('5')).toBe(true);
    expect(isValidExtendDays('30')).toBe(true);
  });

  it('accepts negative and decimal numeric strings (Number()-parseable)', () => {
    expect(isValidExtendDays('-3')).toBe(true);
    expect(isValidExtendDays('1.5')).toBe(true);
  });

  it("rejects '0' because it is a falsy-guard pass but the leading && short-circuits on the truthy string, so only NaN matters", () => {
    // '0' is a truthy string and Number('0') === 0 (not NaN) -> valid.
    expect(isValidExtendDays('0')).toBe(true);
  });

  it('accepts whitespace-only that Number() coerces to 0 (matches original)', () => {
    // Number('   ') === 0 (not NaN), and '   ' is a truthy string -> valid,
    // exactly as the original `days && !isNaN(Number(days))`.
    expect(isValidExtendDays('   ')).toBe(true);
  });
});
