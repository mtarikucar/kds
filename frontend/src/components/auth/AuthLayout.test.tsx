import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthLayout from './AuthLayout';

// --- mocks --------------------------------------------------------------

// i18n: echo the key (or the string fallback) so we can assert on stable text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en' },
  }),
  // i18n/config (imported transitively via RTL_LANGUAGES) calls .use(initReactI18next).
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

// framer-motion: render the underlying tag, drop animation-only props so the
// DOM stays clean. AnimatePresence is a passthrough.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        return ({
          variants,
          initial,
          animate,
          exit,
          transition,
          whileHover,
          whileTap,
          ...props
        }: any) => {
          const Tag = tag as any;
          return <Tag {...props} />;
        };
      },
    },
  ),
}));

vi.mock('../LanguageSwitcher', () => ({
  default: () => <div data-testid="lang-switcher" />,
}));

function renderLayout() {
  return render(
    <MemoryRouter>
      <AuthLayout variant="login">
        <div>form goes here</div>
      </AuthLayout>
    </MemoryRouter>,
  );
}

describe('AuthLayout legal footer', () => {
  // Google OAuth verification requires the homepage (hummytummy.com → /login,
  // which renders this layout) to carry a crawlable link to the privacy policy.
  it('renders a Privacy Policy link pointing at /privacy', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(link).toHaveAttribute('href', '/privacy');
  });

  it('renders a Terms of Service link pointing at /terms', () => {
    renderLayout();
    const link = screen.getByRole('link', { name: 'Terms of Service' });
    expect(link).toHaveAttribute('href', '/terms');
  });
});
