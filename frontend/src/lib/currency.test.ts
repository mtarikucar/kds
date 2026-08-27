import { describe, expect, it } from 'vitest';
import {
  formatCurrency,
  formatCurrencyWithPeriod,
  getCurrencySymbol,
} from './currency';
import { CURRENCY_DISPLAY, formatCurrency as formatCurrencyPinnedRail } from './utils';

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

  // The billing screens used to keep their OWN symbol table, which had no UZS
  // row — so an Uzbek tenant's invoice said "UZS1.234.567,89" while the same
  // money on the QR menu said "1.234.568 so'm". Symbol and precision are facts
  // about the currency, so there is now one table (lib/utils CURRENCY_DISPLAY)
  // and this rail reads it.
  it('takes its symbols from the shared table, for every currency in it', () => {
    for (const [code, rule] of Object.entries(CURRENCY_DISPLAY)) {
      expect(getCurrencySymbol(code)).toBe(rule.symbol);
    }
  });
});

describe('formatCurrency', () => {
  // deep-review FM12: output now uses tr-TR grouping/decimals (₺2.999,00) to
  // match the app-wide lib/utils.formatCurrency, not the old US style.
  it('renders symbol-prefixed amounts with Turkish grouping and decimals', () => {
    expect(formatCurrency(2999, 'TRY')).toBe('₺2.999,00');
    expect(formatCurrency(1234.5, 'USD')).toBe('$1.234,50');
    expect(formatCurrency(0, 'TRY')).toBe('₺0,00');
  });

  it('rounds to two decimals', () => {
    expect(formatCurrency(9.999, 'EUR')).toBe('€10,00');
    expect(formatCurrency(9.994, 'EUR')).toBe('€9,99');
  });

  it('keeps the sign for negative amounts (refunds, write-offs)', () => {
    expect(formatCurrency(-42.1, 'TRY')).toBe('₺-42,10');
  });
});

describe('formatCurrency across rails', () => {
  // The defect this closes: a currency whose symbol/precision was fixed on one
  // rail stayed wrong on the others. Any currency the shared table formats
  // with OUR symbol must come out identically here and on the pinned
  // (non-hook) rail — same symbol, same side, same decimals.
  it('agrees with the pinned rail wherever the table owns the symbol', () => {
    for (const [code, rule] of Object.entries(CURRENCY_DISPLAY)) {
      if (rule.intl !== 'own-symbol') continue;
      expect(formatCurrency(1234567.89, code)).toBe(
        formatCurrencyPinnedRail(1234567.89, code)
      );
    }
  });

  it("renders UZS whole and som-suffixed, not as a two-decimal ISO code", () => {
    expect(formatCurrency(1234567.89, 'UZS')).toBe("1.234.568 so'm");
    expect(formatCurrency(50000, 'UZS')).not.toContain('UZS');
  });

  // KGS is deliberately still the ISO code here (this rail always prefixes its
  // own symbol, and we refuse to guess a Kyrgyz spelling), so its rendering is
  // unchanged — the pin exists to keep U+20C0 from arriving by accident.
  it('leaves KGS on its ISO code', () => {
    expect(formatCurrency(50000, 'KGS')).toBe('KGS50.000,00');
    expect(formatCurrency(50000, 'KGS')).not.toContain('\u20C0');
  });
});

describe('formatCurrencyWithPeriod', () => {
  it('appends the billing period', () => {
    expect(formatCurrencyWithPeriod(99, 'USD', 'month')).toBe('$99,00/month');
  });
});
