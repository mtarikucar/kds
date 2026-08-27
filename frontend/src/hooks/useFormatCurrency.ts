/**
 * Locale-aware currency formatting hook
 * Formats currency with proper locale separators and symbols
 */

import { useCallback } from 'react';
import { useLocale } from './useLocale';
import { useCountryProfile } from './useCountryProfile';
import { formatCurrencyForLocale } from '../lib/utils';

/**
 * Hook providing locale-aware currency formatting
 * Returns a function for backward compatibility
 *
 * @example
 * ```tsx
 * const formatCurrency = useFormatCurrency();
 *
 * // Uses restaurant's configured currency with current locale formatting
 * // In English (USD): "$99.99"
 * // In Turkish (TRY): "₺99,99"
 * // In Uzbek (UZS): "1 234 568 so'm" — whole, and the som by word
 * formatCurrency(99.99)
 * ```
 */
export const useFormatCurrency = (): ((amount: number) => string) => {
  const { intlLocale } = useLocale();
  // Both currency AND its display precision come from the tenant's country
  // profile (Task 7) — never independently: UZS renders with ZERO decimals
  // (so'm is quoted whole) even though ISO-4217 gives it two, while TRY
  // keeps its existing two. Storage/wire stays x100 for every currency,
  // always — this only ever touches the Intl.NumberFormat presentation.
  const { currency, displayDecimals } = useCountryProfile();

  /**
   * Format amount with restaurant's configured currency.
   *
   * The LOCALE is the viewer's, on purpose — an admin reading the dashboard
   * gets the grouping of the language they picked. The SYMBOL and the decimal
   * count are not the viewer's business: they come from CURRENCY_DISPLAY (see
   * lib/utils.ts), the one table every money rail reads, with the country
   * profile's displayDecimals as the fallback for currencies the table has no
   * opinion about.
   */
  const formatCurrency = useCallback(
    (amount: number): string =>
      formatCurrencyForLocale(intlLocale, amount, currency, displayDecimals),
    [intlLocale, currency, displayDecimals]
  );

  return formatCurrency;
};

/**
 * Extended currency formatting hook with more options
 */
export interface UseFormatCurrencyExtendedReturn {
  /** Format amount with restaurant's configured currency */
  formatCurrency: (amount: number) => string;
  /** Format amount with specific currency code */
  formatWithCurrency: (amount: number, currencyCode: string) => string;
  /** Current currency code */
  currency: string;
}

/**
 * Extended hook providing locale-aware currency formatting with more options
 *
 * @example
 * ```tsx
 * const { formatCurrency, formatWithCurrency, currency } = useFormatCurrencyExtended();
 *
 * // Force specific currency
 * formatWithCurrency(99.99, 'EUR') // "€99.99" or "99,99 €"
 * ```
 */
export const useFormatCurrencyExtended = (): UseFormatCurrencyExtendedReturn => {
  const { intlLocale } = useLocale();
  const { currency, displayDecimals } = useCountryProfile();

  /**
   * Format amount with restaurant's configured currency — same rail as
   * useFormatCurrency(): viewer's locale, CURRENCY_DISPLAY's symbol and
   * precision.
   */
  const formatCurrency = useCallback(
    (amount: number): string =>
      formatCurrencyForLocale(intlLocale, amount, currency, displayDecimals),
    [intlLocale, currency, displayDecimals]
  );

  /**
   * Format amount with specific currency code
   *
   * This is an explicit OVERRIDE — a caller passing a currency other than
   * the live tenant currency (e.g. an invoice rendering its OWN frozen
   * `currency` field: InvoicesPage/InvoiceDetailDrawer). There is no country
   * profile to ask for such a record, so precision falls through to ICU
   * except where CURRENCY_DISPLAY has an opinion: "so'm is quoted whole" is a
   * fact about UZS itself, not something that only holds on the
   * live-tenant-currency path.
   */
  const formatWithCurrency = useCallback(
    (amount: number, currencyCode: string): string =>
      formatCurrencyForLocale(intlLocale, amount, currencyCode),
    [intlLocale]
  );

  return {
    formatCurrency,
    formatWithCurrency,
    currency,
  };
};

export default useFormatCurrency;
