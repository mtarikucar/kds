import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enErrors from '../i18n/locales/en/errors.json';
import enCommon from '../i18n/locales/en/common.json';
import enAuth from '../i18n/locales/en/auth.json';
import enPlan from '../i18n/locales/en/plan.json';

// Bootstrap i18next in test mode so components that call useTranslation()
// resolve to real strings instead of echoing back the key. We import a
// small allow-list of namespaces — adding more here is cheap, but we
// don't want to load the full multi-locale bundle for every unit test.
if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        errors: enErrors,
        common: enCommon,
        auth: enAuth,
        plan: enPlan,
      },
    },
  });
}

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;
