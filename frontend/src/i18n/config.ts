import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { rtlLanguages, supportedLanguages } from './localeMap';

// Standalone marketing panel: only the `marketing` namespace plus the
// `common` namespace (defaultNS in the source app) ship with this build.
import enCommon from './locales/en/common.json';
import enMarketing from './locales/en/marketing.json';
import trCommon from './locales/tr/common.json';
import trMarketing from './locales/tr/marketing.json';
import ruCommon from './locales/ru/common.json';
import ruMarketing from './locales/ru/marketing.json';
import uzCommon from './locales/uz/common.json';
import uzMarketing from './locales/uz/marketing.json';
import arCommon from './locales/ar/common.json';
import arMarketing from './locales/ar/marketing.json';

const resources = {
  en: { common: enCommon, marketing: enMarketing },
  tr: { common: trCommon, marketing: trMarketing },
  ru: { common: ruCommon, marketing: ruMarketing },
  uz: { common: uzCommon, marketing: uzMarketing },
  ar: { common: arCommon, marketing: arMarketing },
};

// RTL languages (re-exported from localeMap for backwards compatibility)
export const RTL_LANGUAGES = rtlLanguages;

// All supported language codes (re-exported from localeMap)
export const SUPPORTED_LANGUAGES = supportedLanguages;

// Detect user's preferred language based on browser and saved preference
const getInitialLanguage = (): string => {
  const saved = localStorage.getItem('i18n_language');
  if (saved && ['en', 'tr', 'ru', 'uz', 'ar'].includes(saved)) {
    return saved;
  }

  const browserLang = navigator.language || (navigator as any).userLanguage;
  const langCode = (browserLang || 'en').toLowerCase();

  if (langCode.startsWith('tr')) return 'tr';
  if (langCode.startsWith('ru')) return 'ru';
  if (langCode.startsWith('uz')) return 'uz';
  if (langCode.startsWith('ar')) return 'ar';

  if (navigator.languages) {
    for (const lang of navigator.languages) {
      const code = lang.toLowerCase();
      if (code.startsWith('tr')) return 'tr';
      if (code.startsWith('ru')) return 'ru';
      if (code.startsWith('uz')) return 'uz';
      if (code.startsWith('ar')) return 'ar';
    }
  }

  return 'en';
};

// Missing key tracking for development
const missingKeys = new Set<string>();

const saveMissingHandler = (
  lng: readonly string[],
  ns: string,
  key: string,
  fallbackValue: string
) => {
  const keyPath = `${lng[0]}:${ns}:${key}`;
  if (!missingKeys.has(keyPath)) {
    missingKeys.add(keyPath);
    console.warn(
      `[i18n] Missing translation key: "${key}" in namespace "${ns}" for language "${lng[0]}"`,
      { fallbackValue }
    );
  }
};

// Initialize i18next
i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: getInitialLanguage(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'marketing'],
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: import.meta.env.DEV ? saveMissingHandler : undefined,
    returnEmptyString: false,
  });

// Set initial direction based on the initial language
const initialLang = getInitialLanguage();
document.documentElement.dir = RTL_LANGUAGES.includes(initialLang) ? 'rtl' : 'ltr';

// Save language preference to localStorage when it changes
i18next.on('languageChanged', (lng) => {
  localStorage.setItem('i18n_language', lng);
  document.documentElement.lang = lng;
  document.documentElement.dir = RTL_LANGUAGES.includes(lng) ? 'rtl' : 'ltr';
});

export default i18next;
