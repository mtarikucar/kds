/**
 * Locale-aware date formatting hook
 * Formats dates according to current language settings
 */

import { useCallback, useMemo } from 'react';
import { format as dateFnsFormat } from 'date-fns';
import { useLocale, useDateTimeFormat } from './useLocale';

interface UseFormatDateReturn {
  /** Format date with pattern (uses date-fns format string) */
  formatDate: (date: Date | string | number, formatStr?: string) => string;
  /** Format date with time */
  formatDateTime: (date: Date | string | number) => string;
  /** Format time only */
  formatTime: (date: Date | string | number) => string;
  /** Format date using Intl (no format string needed, locale-aware) */
  formatDateIntl: (date: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
}

/**
 * Hook providing locale-aware date formatting functions
 *
 * @example
 * ```tsx
 * const { formatDate, formatDateTime, formatTime } = useFormatDate();
 *
 * // In English: "December 24, 2024"
 * // In Turkish: "24 Aralık 2024"
 * // In Arabic: "٢٤ ديسمبر ٢٠٢٤"
 * formatDate(new Date())
 *
 * // With custom format
 * formatDate(new Date(), 'yyyy-MM-dd')
 * ```
 */
export const useFormatDate = (): UseFormatDateReturn => {
  const { dateFnsLocale, intlLocale } = useLocale();

  // Intl formatters for common patterns
  const dateFormatter = useDateTimeFormat({
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const dateTimeFormatter = useDateTimeFormat({
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });

  const timeFormatter = useDateTimeFormat({
    hour: 'numeric',
    minute: 'numeric',
  });

  const toDate = useCallback((date: Date | string | number): Date => {
    if (date instanceof Date) return date;
    return new Date(date);
  }, []);

  /**
   * Format date with date-fns pattern
   * Falls back to Intl if date-fns locale not yet loaded
   */
  const formatDate = useCallback(
    (date: Date | string | number, formatStr: string = 'PPP'): string => {
      const dateObj = toDate(date);

      // Use date-fns with locale if available
      if (dateFnsLocale) {
        try {
          return dateFnsFormat(dateObj, formatStr, { locale: dateFnsLocale });
        } catch {
          // Fall back to Intl for invalid format strings
          return dateFormatter.format(dateObj);
        }
      }

      // Fall back to Intl while date-fns locale is loading
      return dateFormatter.format(dateObj);
    },
    [dateFnsLocale, dateFormatter, toDate]
  );

  /**
   * Format date with time
   */
  const formatDateTime = useCallback(
    (date: Date | string | number): string => {
      const dateObj = toDate(date);

      if (dateFnsLocale) {
        try {
          return dateFnsFormat(dateObj, 'PPP p', { locale: dateFnsLocale });
        } catch {
          return dateTimeFormatter.format(dateObj);
        }
      }

      return dateTimeFormatter.format(dateObj);
    },
    [dateFnsLocale, dateTimeFormatter, toDate]
  );

  /**
   * Format time only
   */
  const formatTime = useCallback(
    (date: Date | string | number): string => {
      const dateObj = toDate(date);

      if (dateFnsLocale) {
        try {
          return dateFnsFormat(dateObj, 'p', { locale: dateFnsLocale });
        } catch {
          return timeFormatter.format(dateObj);
        }
      }

      return timeFormatter.format(dateObj);
    },
    [dateFnsLocale, timeFormatter, toDate]
  );

  /**
   * Format date using pure Intl (no format string needed)
   */
  const formatDateIntl = useCallback(
    (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
      const dateObj = toDate(date);
      return new Intl.DateTimeFormat(intlLocale, options).format(dateObj);
    },
    [intlLocale, toDate]
  );

  return {
    formatDate,
    formatDateTime,
    formatTime,
    formatDateIntl,
  };
};

export default useFormatDate;
