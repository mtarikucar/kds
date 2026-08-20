import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const intlLocaleRef = { value: 'en-US' };
const currencyRef = { value: 'USD' };
const displayDecimalsRef = { value: 2 };

vi.mock('./useLocale', () => ({
  useLocale: () => ({ intlLocale: intlLocaleRef.value }),
}));
// useFormatCurrency sources BOTH currency and displayDecimals from the
// country profile (Task 7) — displayDecimals has no independent existence,
// it always travels with the tenant's currency/country pair.
vi.mock('./useCountryProfile', () => ({
  useCountryProfile: () => ({
    currency: currencyRef.value,
    displayDecimals: displayDecimalsRef.value,
  }),
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
    displayDecimalsRef.value = 2;
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

  // Task 7: display decimals come from the country profile, not a fixed 2.
  it('formats TRY with two decimals', () => {
    intlLocaleRef.value = 'tr-TR';
    currencyRef.value = 'TRY';
    displayDecimalsRef.value = 2;
    const { result } = renderHook(() => useFormatCurrency());
    const out = result.current(1234.56);
    expect(out).toContain('₺');
    expect(out).toContain('1.234,56');
  });

  it("formats UZS with NO decimals — so'm is quoted whole", () => {
    intlLocaleRef.value = 'uz-UZ';
    currencyRef.value = 'UZS';
    displayDecimalsRef.value = 0;
    const { result } = renderHook(() => useFormatCurrency());
    // 123456789 minor units (tiyin), converted to major units by the
    // caller (÷100) BEFORE reaching this hook — see the round-trip test
    // below for that boundary. 1234567.89 so'm rounds to a WHOLE 1234568.
    const out = result.current(1234567.89);
    expect(out).not.toContain('.89');
    expect(out).not.toContain(',89');
    // Whole-number grouping of 1 234 568 must survive, just with no
    // fractional part.
    expect(out.replace(/[^\d]/g, '')).toBe('1234568');
  });

  it('round-trips: a UZS amount stored x100 displays whole and re-parses to the same integer', () => {
    intlLocaleRef.value = 'uz-UZ';
    currencyRef.value = 'UZS';
    displayDecimalsRef.value = 0;
    const { result } = renderHook(() => useFormatCurrency());
    // A whole so'm amount stored ×100 (tiyin) — the storage/wire boundary
    // untouched by Task 7 (see country-profile.const.ts). The caller
    // divides by 100 before calling formatCurrency, exactly as every other
    // currency does; only DISPLAY (decimal count) differs for UZS.
    const storedMinorUnits = 10_000_000; // 100,000 so'm, stored as tiyin
    const majorUnits = storedMinorUnits / 100;
    const out = result.current(majorUnits);
    const reparsedMajor = Number(out.replace(/[^\d]/g, ''));
    expect(reparsedMajor * 100).toBe(storedMinorUnits);
  });
});

describe('useFormatCurrencyExtended', () => {
  beforeEach(() => {
    intlLocaleRef.value = 'en-US';
    currencyRef.value = 'USD';
    displayDecimalsRef.value = 2;
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

  it('formatCurrency respects displayDecimals for a UZS tenant', () => {
    intlLocaleRef.value = 'uz-UZ';
    currencyRef.value = 'UZS';
    displayDecimalsRef.value = 0;
    const { result } = renderHook(() => useFormatCurrencyExtended());
    const out = result.current.formatCurrency(1234567.89);
    expect(out.replace(/[^\d]/g, '')).toBe('1234568');
  });

  // A UZS amount rendered via the explicit-override path (invoices/
  // InvoiceDetailDrawer render a record's OWN `currency` field through
  // formatWithCurrency, not the live tenant currency) must STILL show zero
  // decimals — "so'm is quoted whole" is a currency fact, not something
  // that only applies when the tenant's currency happens to match.
  it("formatWithCurrency also renders UZS whole, even though it's the override path", () => {
    const { result } = renderHook(() => useFormatCurrencyExtended());
    const out = result.current.formatWithCurrency(1234567.89, 'UZS');
    expect(out.replace(/[^\d]/g, '')).toBe('1234568');
  });
});
