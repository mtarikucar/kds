import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('AuthLayout mascot click area', () => {
  // Regression test: the mascot PNG canvas is mostly transparent padding, so the
  // full-bleed <img> must never be a click target — otherwise the invisible
  // padding (which can overlap the form) intercepts clicks meant for the inputs.
  it('renders the full-bleed mascot image as non-interactive (pointer-events-none, no onClick)', () => {
    renderLayout();
    const img = screen.getByAltText('HummyTummy Chef Mascot');
    expect(img.className).toContain('pointer-events-none');

    // Clicking the raw <img> must NOT open the speech bubble — there is no
    // onClick handler on it anymore (jsdom doesn't honor pointer-events on
    // fireEvent, so this only passes if the handler was actually removed).
    fireEvent.click(img);
    expect(screen.queryByText(/^auth:mascot\.messages\./)).not.toBeInTheDocument();
  });

  it('exposes a small, separate hotspot over the chef that carries the click handler', () => {
    renderLayout();
    const hotspot = screen.getByRole('button', { name: 'Interact with mascot' });

    // The hotspot must be a small region (sized to the visible chef), not the
    // full mascot bounding box.
    expect(hotspot.className).toContain('w-[42%]');
    expect(hotspot.className).toContain('h-[78%]');
    expect(hotspot.className).not.toContain('w-[400px]');
  });

  it('shows the joke/fact speech bubble when the hotspot is clicked', () => {
    renderLayout();
    expect(screen.queryByText(/^auth:mascot\.messages\./)).not.toBeInTheDocument();

    const hotspot = screen.getByRole('button', { name: 'Interact with mascot' });
    fireEvent.click(hotspot);

    expect(screen.getByText(/^auth:mascot\.messages\./)).toBeInTheDocument();
  });
});

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
