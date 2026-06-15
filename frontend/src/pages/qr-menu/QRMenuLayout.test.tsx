import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError } from 'axios';

// getApiErrorMessage only reads the body off genuine AxiosErrors
// (isAxiosError gate), so the rejection fixture is a real one carrying the
// server message rather than a bare { response } literal.
function axiosErrorWithMessage(message: string): AxiosError {
  const err = new AxiosError('Request failed');
  err.response = { data: { message } } as AxiosError['response'];
  return err;
}

/**
 * Specs for QRMenuLayout — the QR menu shell that fetches menu data and
 * drives the loading/error/loaded states plus the onMenuDataLoaded /
 * onSessionIdChange callbacks. We mock axios, framer-motion (pass-through
 * tags), and the heavy children so we can assert: the menu fetch URL is
 * tenant-scoped (and subdomain-scoped in subdomain mode), a successful
 * fetch invokes onMenuDataLoaded with the payload, and a failed fetch
 * renders the error state with the server message.
 */

const get = vi.fn();
const post = vi.fn();
// Keep the real AxiosError / isAxiosError named exports (getApiErrorMessage,
// reached via the error branch, gates on isAxiosError) while stubbing the
// default client's get/post.
vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    ...actual,
    default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

// Stable t + i18n identities — the fetch effect lists `t` in its deps, so a
// fresh function per render would retrigger the fetch in a loop and keep the
// component pinned in the loading state.
const stableT = (k: string, fb?: any) => (typeof fb === 'string' ? fb : k);
const stableI18n = { language: 'en' };
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: stableI18n }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...p }: any) => {
    const Tag = tag as any;
    const { initial, animate, exit, transition, variants, whileHover, whileTap, ...rest } = p;
    return <Tag {...rest}>{children}</Tag>;
  } }),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../components/ui/Spinner', () => ({ default: () => <div data-testid="spinner" /> }));
vi.mock('../../components/qr-menu/MenuDrawer', () => ({ default: () => null }));

vi.mock('../../utils/subdomain', () => ({ buildQRMenuUrl: () => '/url' }));
vi.mock('../../lib/utils', () => ({ formatCurrency: (n: number) => `$${n}` }));
// Avoid pulling in the real i18n bootstrap (LanguageDetector init) — we only
// need the RTL language list the layout reads.
vi.mock('../../i18n/config', () => ({ RTL_LANGUAGES: ['ar', 'he'], default: {} }));

const initializeSession = vi.fn();
vi.mock('../../store/cartStore', () => ({
  useCartStore: (selector: any) => selector({
    sessionId: 'sess-1',
    items: [],
    getTotal: () => 0,
    initializeSession,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ tenantId: 't-1' }),
    useSearchParams: () => [{ get: () => null }],
    useNavigate: () => vi.fn(),
  };
});

import QRMenuLayout from './QRMenuLayout';

function renderLayout(props: any = {}) {
  return render(
    <MemoryRouter>
      <QRMenuLayout currentPage="menu" {...props}>
        <div data-testid="child" />
      </QRMenuLayout>
    </MemoryRouter>,
  );
}

const menuData = {
  tenant: { id: 't-1', name: 'Acme Diner', currency: 'TRY' },
  settings: { primaryColor: '#fff', backgroundColor: '#fff', fontFamily: 'sans', showImages: true },
  enableCustomerOrdering: true,
  enableTablelessMode: false,
  categories: [],
};

beforeEach(() => vi.clearAllMocks());

describe('QRMenuLayout — loading', () => {
  it('shows the spinner before data resolves', () => {
    get.mockReturnValue(new Promise(() => {})); // never resolves
    renderLayout();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });
});

describe('QRMenuLayout — successful fetch', () => {
  it('fetches the tenant-scoped menu and reports the data via onMenuDataLoaded', async () => {
    get.mockResolvedValue({ data: menuData });
    const onMenuDataLoaded = vi.fn();
    renderLayout({ onMenuDataLoaded });

    await waitFor(() => expect(onMenuDataLoaded).toHaveBeenCalledWith(menuData));
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/qr-menu/t-1'));
    // Header shows the tenant name once loaded.
    await waitFor(() => expect(screen.getByText('Acme Diner')).toBeInTheDocument());
    // Cart session initialized from the loaded tenant.
    expect(initializeSession).toHaveBeenCalledWith('t-1', null, 'TRY');
  });

  it('uses the subdomain endpoint in subdomain mode', async () => {
    get.mockResolvedValue({ data: menuData });
    renderLayout({ subdomain: 'acme' });
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining('/qr-menu/by-subdomain/acme')));
  });
});

describe('QRMenuLayout — error', () => {
  it('renders the server error message and a back-home button on fetch failure', async () => {
    get.mockRejectedValue(axiosErrorWithMessage('menu offline'));
    renderLayout();
    await waitFor(() => expect(screen.getByText('menu offline')).toBeInTheDocument());
    // backHome button uses an inline English fallback -> 'Back Home'.
    expect(screen.getByText('Back Home')).toBeInTheDocument();
  });
});
