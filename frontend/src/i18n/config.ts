import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

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
  },
};

// Get saved language from localStorage or default to 'en'
const getSavedLanguage = (): string => {
  const saved = localStorage.getItem('i18n_language');
  return saved && ['en', 'tr'].includes(saved) ? saved : 'en';
};

// Initialize i18next
i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    lng: getSavedLanguage(),
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'auth', 'pos', 'kitchen', 'menu', 'orders', 'customers', 'settings', 'subscriptions', 'reports', 'validation', 'errors'],
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Save language preference to localStorage when it changes
i18next.on('languageChanged', (lng) => {
  localStorage.setItem('i18n_language', lng);
  // Update HTML lang attribute for accessibility and SEO
  document.documentElement.lang = lng;
});

export default i18next;

