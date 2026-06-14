import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatCurrencyWithPeriod,
  getCurrencySymbol,
} from './currency';

describe('getCurrencySymbol', () => {
  it('maps known currency codes to their symbols', () => {
    expect(getCurrencySymbol('TRY')).toBe('₺');
    expect(getCurrencySymbol('USD')).toBe('$');
    expect(getCurrencySymbol('EUR')).toBe('€');
    expect(getCurrencySymbol('GBP')).toBe('£');
  });

  it('defaults to TRY', () => {
    expect(getCurrencySymbol()).toBe('₺');
  });

  it('falls back to the raw code for unknown currencies', () => {
    expect(getCurrencySymbol('JPY')).toBe('JPY');
  });
});

describe('formatCurrency', () => {
  it('renders symbol-prefixed two-decimal amounts', () => {
    expect(formatCurrency(1234.5, 'USD')).toBe('$1234.50');
    expect(formatCurrency(0, 'TRY')).toBe('₺0.00');
  });

  it('rounds to two decimals', () => {
    expect(formatCurrency(9.999, 'EUR')).toBe('€10.00');
    expect(formatCurrency(9.994, 'EUR')).toBe('€9.99');
  });

  it('keeps the sign for negative amounts (refunds, write-offs)', () => {
    expect(formatCurrency(-42.1, 'TRY')).toBe('₺-42.10');
  });
});

describe('formatCurrencyWithPeriod', () => {
  it('appends the billing period', () => {
    expect(formatCurrencyWithPeriod(99, 'USD', 'month')).toBe('$99.00/month');
  });
});
