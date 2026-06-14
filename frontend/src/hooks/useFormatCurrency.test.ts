import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const intlLocaleRef = { value: 'en-US' };
const currencyRef = { value: 'USD' };

vi.mock('./useLocale', () => ({
  useLocale: () => ({ intlLocale: intlLocaleRef.value }),
}));
vi.mock('./useCurrency', () => ({
  useCurrency: () => currencyRef.value,
}));

import {
  useFormatCurrency,
  useFormatCurrencyExtended,
} from './useFormatCurrency';

/**
 * useFormatCurrency binds the tenant's configured currency to the active
 * Intl locale. The branchy part is the extended hook's formatWithCurrency,
 * which must override the tenant currency while keeping locale formatting.
 * We assert concrete glyph + separator output so a swap of locale/currency
 * wiring (a classic copy-paste bug) is caught.
 */
describe('useFormatCurrency', () => {
  beforeEach(() => {
    intlLocaleRef.value = 'en-US';
    currencyRef.value = 'USD';
  });

  it('formats with the tenant currency under the active locale (USD/en-US)', () => {
    const { result } = renderHook(() => useFormatCurrency());
    expect(result.current(99.99)).toBe('$99.99');
  });

  it('uses Turkish grouping + lira symbol when locale=tr-TR, currency=TRY', () => {
    intlLocaleRef.value = 'tr-TR';
    currencyRef.value = 'TRY';
    const { result } = renderHook(() => useFormatCurrency());
    // tr-TR places the symbol after, uses ',' decimal + non-breaking space.
    const out = result.current(1234.5);
    expect(out).toContain('₺');
    expect(out).toContain('1.234,50');
  });
});

describe('useFormatCurrencyExtended', () => {
  beforeEach(() => {
    intlLocaleRef.value = 'en-US';
    currencyRef.value = 'USD';
  });

  it('exposes the resolved tenant currency code', () => {
    currencyRef.value = 'GBP';
    const { result } = renderHook(() => useFormatCurrencyExtended());
    expect(result.current.currency).toBe('GBP');
  });

  it('formatCurrency uses the tenant currency, formatWithCurrency overrides it', () => {
    const { result } = renderHook(() => useFormatCurrencyExtended());
    expect(result.current.formatCurrency(10)).toBe('$10.00');
    // Override to EUR but keep the en-US locale formatting.
    expect(result.current.formatWithCurrency(10, 'EUR')).toBe('€10.00');
  });
});
