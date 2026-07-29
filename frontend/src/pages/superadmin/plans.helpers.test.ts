import { describe, expect, it } from 'vitest';
import {
  discountedMonthlyPrice,
  isDemoPlan,
  resolvePlanAmountForCycle,
} from './plans.helpers';

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

describe('isDemoPlan', () => {
  it('matches only the exact internal DEMO name', () => {
    expect(isDemoPlan({ name: 'DEMO' })).toBe(true);
    expect(isDemoPlan({ name: 'demo' })).toBe(false);
    expect(isDemoPlan({ name: 'DEMO2' })).toBe(false);
    expect(isDemoPlan({ name: undefined })).toBe(false);
  });
});

describe('resolvePlanAmountForCycle', () => {
  const base = { monthlyPrice: 1000, yearlyPrice: 10000 };

  it('returns the monthly price for MONTHLY and yearly for YEARLY', () => {
    expect(resolvePlanAmountForCycle(base, 'MONTHLY')).toBe(1000);
    expect(resolvePlanAmountForCycle(base, 'YEARLY')).toBe(10000);
  });

  it('applies a live discount inside its window (mirrors backend resolvePlanAmount)', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const plan = {
      ...base,
      isDiscountActive: true,
      discountPercentage: 20,
      discountStartDate: '2026-06-01T00:00:00Z',
      discountEndDate: '2026-06-30T23:59:59Z',
    };
    expect(resolvePlanAmountForCycle(plan, 'MONTHLY', now)).toBe(800);
    expect(resolvePlanAmountForCycle(plan, 'YEARLY', now)).toBe(8000);
  });

  it('ignores a discount outside its window or with the flag off', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    const expired = {
      ...base,
      isDiscountActive: true,
      discountPercentage: 20,
      discountStartDate: '2026-06-01T00:00:00Z',
      discountEndDate: '2026-06-30T23:59:59Z',
    };
    expect(resolvePlanAmountForCycle(expired, 'MONTHLY', now)).toBe(1000);
    const inactive = { ...expired, isDiscountActive: false, discountEndDate: '2026-12-31T00:00:00Z' };
    expect(resolvePlanAmountForCycle(inactive, 'MONTHLY', now)).toBe(1000);
  });

  it('rounds discounted amounts to 2 decimals', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const plan = {
      monthlyPrice: 1799,
      yearlyPrice: 17990,
      isDiscountActive: true,
      discountPercentage: 33,
      discountStartDate: '2026-06-01T00:00:00Z',
      discountEndDate: '2026-06-30T23:59:59Z',
    };
    expect(resolvePlanAmountForCycle(plan, 'MONTHLY', now)).toBe(1205.33);
  });
});
