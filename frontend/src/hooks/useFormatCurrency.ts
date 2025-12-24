/**
 * Locale-aware currency formatting hook
 * Formats currency with proper locale separators and symbols
 */

import { useCallback, useMemo } from 'react';
import { useLocale } from './useLocale';
import { useCurrency } from './useCurrency';

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
  const currency = useCurrency();

  // Cached formatter for the restaurant's currency
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: currency,
      }),
    [intlLocale, currency]
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
  const currency = useCurrency();

  // Cached formatter for the restaurant's currency
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: currency,
      }),
    [intlLocale, currency]
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
   */
  const formatWithCurrency = useCallback(
    (amount: number, currencyCode: string): string => {
      return new Intl.NumberFormat(intlLocale, {
        style: 'currency',
        currency: currencyCode,
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
