import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { rtlLanguages, supportedLanguages } from './localeMap';

// Import translation files
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enPos from './locales/en/pos.json';
import enKitchen from './locales/en/kitchen.json';
import enMenu from './locales/en/menu.json';
import enOrders from './locales/en/orders.json';
import enCustomers from './locales/en/customers.json';
import enSettings from './locales/en/settings.json';
import enSubscriptions from './locales/en/subscriptions.json';
import enReports from './locales/en/reports.json';
import enValidation from './locales/en/validation.json';
import enErrors from './locales/en/errors.json';
import enOnboarding from './locales/en/onboarding.json';
import enReservations from './locales/en/reservations.json';

import trCommon from './locales/tr/common.json';
import trAuth from './locales/tr/auth.json';
import trPos from './locales/tr/pos.json';
import trKitchen from './locales/tr/kitchen.json';
import trMenu from './locales/tr/menu.json';
import trOrders from './locales/tr/orders.json';
import trCustomers from './locales/tr/customers.json';
import trSettings from './locales/tr/settings.json';
import trSubscriptions from './locales/tr/subscriptions.json';
import trReports from './locales/tr/reports.json';
import trValidation from './locales/tr/validation.json';
import trErrors from './locales/tr/errors.json';
import trOnboarding from './locales/tr/onboarding.json';
import trReservations from './locales/tr/reservations.json';

import ruCommon from './locales/ru/common.json';
import ruAuth from './locales/ru/auth.json';
import ruPos from './locales/ru/pos.json';
import ruKitchen from './locales/ru/kitchen.json';
import ruMenu from './locales/ru/menu.json';
import ruOrders from './locales/ru/orders.json';
import ruCustomers from './locales/ru/customers.json';
import ruSettings from './locales/ru/settings.json';
import ruSubscriptions from './locales/ru/subscriptions.json';
import ruReports from './locales/ru/reports.json';
import ruValidation from './locales/ru/validation.json';
import ruErrors from './locales/ru/errors.json';
import ruOnboarding from './locales/ru/onboarding.json';
import ruReservations from './locales/ru/reservations.json';

import uzCommon from './locales/uz/common.json';
import uzAuth from './locales/uz/auth.json';
import uzPos from './locales/uz/pos.json';
import uzKitchen from './locales/uz/kitchen.json';
import uzMenu from './locales/uz/menu.json';
import uzOrders from './locales/uz/orders.json';
import uzCustomers from './locales/uz/customers.json';
import uzSettings from './locales/uz/settings.json';
import uzSubscriptions from './locales/uz/subscriptions.json';
import uzReports from './locales/uz/reports.json';
import uzValidation from './locales/uz/validation.json';
import uzErrors from './locales/uz/errors.json';
import uzOnboarding from './locales/uz/onboarding.json';
import uzReservations from './locales/uz/reservations.json';

import arCommon from './locales/ar/common.json';
import arAuth from './locales/ar/auth.json';
import arPos from './locales/ar/pos.json';
import arKitchen from './locales/ar/kitchen.json';
import arMenu from './locales/ar/menu.json';
import arOrders from './locales/ar/orders.json';
import arCustomers from './locales/ar/customers.json';
import arSettings from './locales/ar/settings.json';
import arSubscriptions from './locales/ar/subscriptions.json';
import arReports from './locales/ar/reports.json';
import arValidation from './locales/ar/validation.json';
import arErrors from './locales/ar/errors.json';
import arOnboarding from './locales/ar/onboarding.json';
import arReservations from './locales/ar/reservations.json';

// Define resources
const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    pos: enPos,
    kitchen: enKitchen,
    menu: enMenu,
    orders: enOrders,
    customers: enCustomers,
    settings: enSettings,
    subscriptions: enSubscriptions,
    reports: enReports,
    validation: enValidation,
    errors: enErrors,
    onboarding: enOnboarding,
    reservations: enReservations,
  },
  tr: {
    common: trCommon,
    auth: trAuth,
    pos: trPos,
    kitchen: trKitchen,
    menu: trMenu,
    orders: trOrders,
    customers: trCustomers,
    settings: trSettings,
    subscriptions: trSubscriptions,
    reports: trReports,
    validation: trValidation,
    errors: trErrors,
    onboarding: trOnboarding,
    reservations: trReservations,
  },
  ru: {
    common: ruCommon,
    auth: ruAuth,
    pos: ruPos,
    kitchen: ruKitchen,
    menu: ruMenu,
    orders: ruOrders,
    customers: ruCustomers,
    settings: ruSettings,
    subscriptions: ruSubscriptions,
    reports: ruReports,
    validation: ruValidation,
    errors: ruErrors,
    onboarding: ruOnboarding,
    reservations: ruReservations,
  },
  uz: {
    common: uzCommon,
    auth: uzAuth,
    pos: uzPos,
    kitchen: uzKitchen,
    menu: uzMenu,
    orders: uzOrders,
    customers: uzCustomers,
    settings: uzSettings,
    subscriptions: uzSubscriptions,
    reports: uzReports,
    validation: uzValidation,
    errors: uzErrors,
    onboarding: uzOnboarding,
    reservations: uzReservations,
  },
  ar: {
    common: arCommon,
    auth: arAuth,
    pos: arPos,
    kitchen: arKitchen,
    menu: arMenu,
    orders: arOrders,
    customers: arCustomers,
    settings: arSettings,
    subscriptions: arSubscriptions,
    reports: arReports,
    validation: arValidation,
    errors: arErrors,
    onboarding: arOnboarding,
    reservations: arReservations,
  },
};

// RTL languages (re-exported from localeMap for backwards compatibility)
export const RTL_LANGUAGES = rtlLanguages;

// All supported language codes (re-exported from localeMap)
export const SUPPORTED_LANGUAGES = supportedLanguages;

// Detect user's preferred language based on browser and location
const getInitialLanguage = (): string => {
  // First check if user has manually selected a language before
  const saved = localStorage.getItem('i18n_language');
  if (saved && ['en', 'tr', 'ru', 'uz', 'ar'].includes(saved)) {
    return saved;
  }

  // Check browser language
  const browserLang = navigator.language || (navigator as any).userLanguage;
  const langCode = browserLang.toLowerCase();

  // Check for Turkish
  if (langCode.startsWith('tr')) {
    return 'tr';
  }

  // Check for Russian
  if (langCode.startsWith('ru')) {
    return 'ru';
  }

  // Check for Uzbek
  if (langCode.startsWith('uz')) {
    return 'uz';
  }

  // Check for Arabic
  if (langCode.startsWith('ar')) {
    return 'ar';
  }

  // Check if browser languages array includes any supported language
  if (navigator.languages) {
    for (const lang of navigator.languages) {
      const code = lang.toLowerCase();
      if (code.startsWith('tr')) return 'tr';
      if (code.startsWith('ru')) return 'ru';
      if (code.startsWith('uz')) return 'uz';
      if (code.startsWith('ar')) return 'ar';
    }
  }

  // Default to English for all other cases
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
    ns: ['common', 'auth', 'pos', 'kitchen', 'menu', 'orders', 'customers', 'settings', 'subscriptions', 'reports', 'validation', 'errors', 'onboarding', 'reservations'],
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    // Missing key detection (development only)
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: import.meta.env.DEV ? saveMissingHandler : undefined,
    // Return empty string for missing keys in production (shows fallback)
    returnEmptyString: false,
  });

// Set initial direction based on the initial language
const initialLang = getInitialLanguage();
document.documentElement.dir = RTL_LANGUAGES.includes(initialLang) ? 'rtl' : 'ltr';

// Save language preference to localStorage when it changes
i18next.on('languageChanged', (lng) => {
  localStorage.setItem('i18n_language', lng);
  // Update HTML lang attribute for accessibility and SEO
  document.documentElement.lang = lng;
  // Update HTML dir attribute for RTL languages
  document.documentElement.dir = RTL_LANGUAGES.includes(lng) ? 'rtl' : 'ltr';
});

export default i18next;

