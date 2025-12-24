/**
 * Central hook for locale-aware operations
 * Provides current language, Intl locale, date-fns locale, and RTL detection
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale as DateFnsLocale } from 'date-fns';
import { getLocaleConfig, type LocaleConfig } from '../i18n/localeMap';

interface UseLocaleReturn {
  /** Current language code (e.g., 'en', 'tr', 'ar') */
  language: string;
  /** Full locale configuration */
  localeConfig: LocaleConfig;
  /** BCP 47 Intl locale (e.g., 'en-US', 'ar-SA') */
  intlLocale: string;
  /** Whether current language is RTL */
  isRTL: boolean;
  /** date-fns locale object (loaded async) */
  dateFnsLocale: DateFnsLocale | undefined;
  /** Default currency for current locale */
  defaultCurrency: string;
}

/**
 * Central hook providing locale information for formatting
 *
 * @example
 * ```tsx
 * const { intlLocale, dateFnsLocale, isRTL } = useLocale();
 *
 * // Use with Intl APIs
 * new Intl.NumberFormat(intlLocale).format(1234.5);
 *
 * // Use with date-fns
 * if (dateFnsLocale) {
 *   format(new Date(), 'PPP', { locale: dateFnsLocale });
 * }
 * ```
 */
export const useLocale = (): UseLocaleReturn => {
  const { i18n } = useTranslation();
  const [dateFnsLocale, setDateFnsLocale] = useState<DateFnsLocale | undefined>(undefined);

  const language = i18n.language;
  const localeConfig = useMemo(() => getLocaleConfig(language), [language]);

  // Load date-fns locale asynchronously
  useEffect(() => {
    let mounted = true;

    localeConfig.dateFnsLocale().then((locale) => {
      if (mounted) {
        setDateFnsLocale(locale);
      }
    }).catch((error) => {
      console.warn(`Failed to load date-fns locale for ${language}:`, error);
      // Fall back to English locale
      if (mounted && language !== 'en') {
        import('date-fns/locale').then(({ enUS }) => {
          if (mounted) {
            setDateFnsLocale(enUS);
          }
        });
      }
    });

    return () => {
      mounted = false;
    };
  }, [language, localeConfig]);

  return {
    language,
    localeConfig,
    intlLocale: localeConfig.intlLocale,
    isRTL: localeConfig.rtl,
    dateFnsLocale,
    defaultCurrency: localeConfig.defaultCurrency,
  };
};

/**
 * Hook to get a cached Intl.NumberFormat instance
 * Reuses instances for performance
 */
export const useNumberFormat = (options?: Intl.NumberFormatOptions) => {
  const { intlLocale } = useLocale();

  return useMemo(() => {
    return new Intl.NumberFormat(intlLocale, options);
  }, [intlLocale, JSON.stringify(options)]);
};

/**
 * Hook to get a cached Intl.DateTimeFormat instance
 */
export const useDateTimeFormat = (options?: Intl.DateTimeFormatOptions) => {
  const { intlLocale } = useLocale();

  return useMemo(() => {
    return new Intl.DateTimeFormat(intlLocale, options);
  }, [intlLocale, JSON.stringify(options)]);
};

/**
 * Hook to get a cached Intl.RelativeTimeFormat instance
 */
export const useRelativeTimeFormat = (options?: Intl.RelativeTimeFormatOptions) => {
  const { intlLocale } = useLocale();

  return useMemo(() => {
    return new Intl.RelativeTimeFormat(intlLocale, {
      numeric: 'auto',
      style: 'long',
      ...options,
    });
  }, [intlLocale, JSON.stringify(options)]);
};

export default useLocale;
