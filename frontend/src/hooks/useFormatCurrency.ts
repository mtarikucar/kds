/**
 * Locale-aware currency formatting hook
 * Formats currency with proper locale separators and symbols
 */

import { useCallback, useMemo } from 'react';
import { useLocale } from './useLocale';
import { useCountryProfile } from './useCountryProfile';
import { CURRENCY_DECIMALS_OVERRIDE } from '../lib/utils';

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
 * // In Turkish (TRY): "99,99 ₺"
 * // In Arabic (SAR): "٩٩٫٩٩ ر.س."
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

  // Cached formatter for the restaurant's currency
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: displayDecimals,
        maximumFractionDigits: displayDecimals,
      }),
    [intlLocale, currency, displayDecimals]
  );

  /**
   * Format amount with restaurant's configured currency
   */
  const formatCurrency = useCallback(
    (amount: number): string => {
      return currencyFormatter.format(amount);
    },
    [currencyFormatter]
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

  // Cached formatter for the restaurant's currency
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: displayDecimals,
        maximumFractionDigits: displayDecimals,
      }),
    [intlLocale, currency, displayDecimals]
  );

  /**
   * Format amount with restaurant's configured currency
   */
  const formatCurrency = useCallback(
    (amount: number): string => {
      return currencyFormatter.format(amount);
    },
    [currencyFormatter]
  );

  /**
   * Format amount with specific currency code
   *
   * This is an explicit OVERRIDE — a caller passing a currency other than
   * the live tenant currency (e.g. an invoice rendering its OWN frozen
   * `currency` field: InvoicesPage/InvoiceDetailDrawer). It uses Intl's own
   * default precision for whatever currency is passed, EXCEPT the same
   * small override useFormatCurrency() applies for the tenant's own
   * currency: "so'm is quoted whole" is a fact about UZS itself, not
   * something that only holds on the live-tenant-currency path.
   */
  const formatWithCurrency = useCallback(
    (amount: number, currencyCode: string): string => {
      const decimalsOverride = CURRENCY_DECIMALS_OVERRIDE[currencyCode];
      return new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: currencyCode,
        ...(decimalsOverride !== undefined
          ? { minimumFractionDigits: decimalsOverride, maximumFractionDigits: decimalsOverride }
          : {}),
      }).format(amount);
    },
    [intlLocale]
  );

  return {
    formatCurrency,
    formatWithCurrency,
    currency,
  };
};

export default useFormatCurrency;
