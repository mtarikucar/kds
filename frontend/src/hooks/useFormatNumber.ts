/**
 * Locale-aware number formatting hook
 * Formats numbers with proper separators for current language
 */

import { useCallback, useMemo } from 'react';
import { useLocale } from './useLocale';

interface UseFormatNumberReturn {
  /** Format number with locale separators */
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** Format as percentage */
  formatPercent: (value: number, decimals?: number) => string;
  /** Format as compact notation (1K, 1M, etc.) */
  formatCompact: (value: number) => string;
  /** Format with specific decimal places */
  formatDecimal: (value: number, decimals?: number) => string;
}

/**
 * Hook providing locale-aware number formatting functions
 *
 * @example
 * ```tsx
 * const { formatNumber, formatPercent, formatCompact } = useFormatNumber();
 *
 * // In English: "1,234.56"
 * // In Turkish: "1.234,56"
 * // In Russian: "1 234,56"
 * // In Arabic: "١٬٢٣٤٫٥٦"
 * formatNumber(1234.56)
 *
 * // "75%"
 * formatPercent(0.75)
 *
 * // "1.2K" or "1,2K" depending on locale
 * formatCompact(1234)
 * ```
 */
export const useFormatNumber = (): UseFormatNumberReturn => {
  const { intlLocale } = useLocale();

  // Cached formatters for common operations
  const decimalFormatter = useMemo(
    () => new Intl.NumberFormat(intlLocale, { style: 'decimal' }),
    [intlLocale]
  );

  const percentFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        style: 'percent',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      }),
    [intlLocale]
  );

  const compactFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale, {
        notation: 'compact',
        compactDisplay: 'short',
      }),
    [intlLocale]
  );

  /**
   * Format number with locale separators
   */
  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions): string => {
      if (options) {
        return new Intl.NumberFormat(intlLocale, options).format(value);
      }
      return decimalFormatter.format(value);
    },
    [intlLocale, decimalFormatter]
  );

  /**
   * Format as percentage
   */
  const formatPercent = useCallback(
    (value: number, decimals?: number): string => {
      if (decimals !== undefined) {
        return new Intl.NumberFormat(intlLocale, {
          style: 'percent',
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }).format(value);
      }
      return percentFormatter.format(value);
    },
    [intlLocale, percentFormatter]
  );

  /**
   * Format as compact notation (1K, 1M, etc.)
   */
  const formatCompact = useCallback(
    (value: number): string => {
      return compactFormatter.format(value);
    },
    [compactFormatter]
  );

  /**
   * Format with specific decimal places
   */
  const formatDecimal = useCallback(
    (value: number, decimals: number = 2): string => {
      return new Intl.NumberFormat(intlLocale, {
        style: 'decimal',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
    },
    [intlLocale]
  );

  return {
    formatNumber,
    formatPercent,
    formatCompact,
    formatDecimal,
  };
};

export default useFormatNumber;
