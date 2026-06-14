import { describe, expect, it } from 'vitest';
import { discountedMonthlyPrice } from './plans.helpers';

describe('discountedMonthlyPrice', () => {
  it('applies a percentage discount to a numeric price', () => {
    expect(discountedMonthlyPrice(100, 20)).toBe(80);
    expect(discountedMonthlyPrice(200, 50)).toBe(100);
  });

  it('coerces string prices via Number()', () => {
    expect(discountedMonthlyPrice('100', 10)).toBe(90);
  });

  it('returns the full price for a 0% discount', () => {
    expect(discountedMonthlyPrice(149, 0)).toBe(149);
  });

  it('returns 0 for a 100% discount', () => {
    expect(discountedMonthlyPrice(149, 100)).toBe(0);
  });

  it('handles fractional results (no rounding in the helper)', () => {
    expect(discountedMonthlyPrice(99.99, 10)).toBeCloseTo(89.991, 5);
  });
});
