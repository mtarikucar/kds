/**
 * Locale-aware relative time formatting hook
 * Formats relative time (e.g., "5 minutes ago") in current language
 */

import { useCallback, useMemo } from 'react';
import { formatDistanceToNow, formatDistance } from 'date-fns';
import { useLocale, useRelativeTimeFormat } from './useLocale';

interface UseFormatRelativeTimeReturn {
  /** Format as relative time from now (e.g., "5 minutes ago") */
  formatTimeAgo: (date: Date | string | number, addSuffix?: boolean) => string;
  /** Format distance between two dates */
  formatRelative: (date: Date | string | number, baseDate: Date | string | number) => string;
  /** Format using Intl.RelativeTimeFormat (more control) */
  formatRelativeIntl: (value: number, unit: Intl.RelativeTimeFormatUnit) => string;
}

/**
 * Hook providing locale-aware relative time formatting
 *
 * @example
 * ```tsx
 * const { formatTimeAgo, formatRelative } = useFormatRelativeTime();
 *
 * // In English: "5 minutes ago"
 * // In Turkish: "5 dakika önce"
 * // In Russian: "5 минут назад"
 * // In Arabic: "منذ 5 دقائق"
 * formatTimeAgo(pastDate)
 *
 * // "in 2 days" or "через 2 дня" etc.
 * formatTimeAgo(futureDate)
 * ```
 */
export const useFormatRelativeTime = (): UseFormatRelativeTimeReturn => {
  const { dateFnsLocale, intlLocale } = useLocale();

  const relativeFormatter = useRelativeTimeFormat();

  const toDate = useCallback((date: Date | string | number): Date => {
    if (date instanceof Date) return date;
    return new Date(date);
  }, []);

  /**
   * Format as relative time from now
   */
  const formatTimeAgo = useCallback(
    (date: Date | string | number, addSuffix: boolean = true): string => {
      const dateObj = toDate(date);

      // Use date-fns with locale if available
      if (dateFnsLocale) {
        try {
          return formatDistanceToNow(dateObj, {
            addSuffix,
            locale: dateFnsLocale,
          });
        } catch {
          // Fall back to Intl
          return formatWithIntl(dateObj, relativeFormatter);
        }
      }

      // Fall back to Intl while date-fns locale is loading
      return formatWithIntl(dateObj, relativeFormatter);
    },
    [dateFnsLocale, relativeFormatter, toDate]
  );

  /**
   * Format distance between two dates
   */
  const formatRelative = useCallback(
    (date: Date | string | number, baseDate: Date | string | number): string => {
      const dateObj = toDate(date);
      const baseDateObj = toDate(baseDate);

      if (dateFnsLocale) {
        try {
          return formatDistance(dateObj, baseDateObj, {
            addSuffix: true,
            locale: dateFnsLocale,
          });
        } catch {
          return formatWithIntl(dateObj, relativeFormatter, baseDateObj);
        }
      }

      return formatWithIntl(dateObj, relativeFormatter, baseDateObj);
    },
    [dateFnsLocale, relativeFormatter, toDate]
  );

  /**
   * Format using Intl.RelativeTimeFormat directly
   */
  const formatRelativeIntl = useCallback(
    (value: number, unit: Intl.RelativeTimeFormatUnit): string => {
      return relativeFormatter.format(value, unit);
    },
    [relativeFormatter]
  );

  return {
    formatTimeAgo,
    formatRelative,
    formatRelativeIntl,
  };
};

/**
 * Helper function to format relative time using Intl.RelativeTimeFormat
 */
function formatWithIntl(
  date: Date,
  formatter: Intl.RelativeTimeFormat,
  baseDate: Date = new Date()
): string {
  const diffMs = date.getTime() - baseDate.getTime();
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);
  const diffWeeks = Math.round(diffDays / 7);
  const diffMonths = Math.round(diffDays / 30);
  const diffYears = Math.round(diffDays / 365);

  // Choose appropriate unit
  if (Math.abs(diffSeconds) < 60) {
    return formatter.format(diffSeconds, 'second');
  } else if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute');
  } else if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour');
  } else if (Math.abs(diffDays) < 7) {
    return formatter.format(diffDays, 'day');
  } else if (Math.abs(diffWeeks) < 4) {
    return formatter.format(diffWeeks, 'week');
  } else if (Math.abs(diffMonths) < 12) {
    return formatter.format(diffMonths, 'month');
  } else {
    return formatter.format(diffYears, 'year');
  }
}

export default useFormatRelativeTime;
