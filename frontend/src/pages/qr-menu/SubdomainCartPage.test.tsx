import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Specs for SubdomainCartPage — the subdomain variant of the QR cart
 * submit flow. Differs from CartPage in that tenantId comes from the
 * loaded menu data and the post-order navigation is built via
 * buildQRMenuUrl(subdomain). We assert the C1 server-session flow, the
 * mapped order POST, and the subdomain-aware success navigation.
 */

const post = vi.fn();
// getApiErrorMessage (catch path) reads the named isAxiosError export.
vi.mock('axios', () => ({
  default: { post: (...a: unknown[]) => post(...a) },
  isAxiosError: (e: unknown) => !!(e as { isAxiosError?: boolean } | undefined)?.isAxiosError,
}));

// Review C1: session rail mocked — unit-tested in customerSession.test.ts.
const MINTED_SESSION = 'f'.repeat(64);
const ensureCustomerSession = vi.fn();
vi.mock('../../features/qr-menu/customerSession', () => ({
  ensureCustomerSession: (...a: unknown[]) => ensureCustomerSession(...a),
  withCustomerSession: async (fn: (sid: string) => Promise<unknown>) =>
    fn(await ensureCustomerSession()),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
// getApiErrorMessage (reached via the catch path) imports i18n/config, which
// would eagerly re-init i18next against the partial react-i18next mock. Stub it.
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => [{ get: () => 'tbl-9' }],
  };
});

const buildQRMenuUrl = vi.fn((..._a: unknown[]) => '/built-orders-url');
vi.mock('../../utils/subdomain', () => ({ buildQRMenuUrl: (...a: unknown[]) => buildQRMenuUrl(...a) }));

let cart: any;
vi.mock('../../store/cartStore', () => ({ useCartStore: () => cart }));

// Mutable so a spec can put the browser in "no position" state — the case
// that used to POST anyway and hand the guest the server's Turkish refusal.
let geo: { latitude: number | null; longitude: number | null; loading: boolean };
const getCurrentPosition = vi.fn();
vi.mock('../../hooks', () => ({
  useGeolocation: () => ({ ...geo, getCurrentPosition }),
}));

const clearCart = vi.fn();
let menuFixture: any;
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, subdomain, onMenuDataLoaded }: any) => (
    <div data-subdomain={subdomain}>
      <button onClick={() => onMenuDataLoaded(menuFixture)}>load</button>
      {children}
    </div>
  ),
}));
vi.mock('../../components/qr-menu/CartContent', () => ({
  default: ({ onSubmitOrder, onSpecialNotesChange }: any) => (
    <div>
      <button onClick={() => onSpecialNotesChange('no pickles')}>type-notes</button>
      <button onClick={onSubmitOrder}>submit</button>
    </div>
  ),
}));
vi.mock('../../components/qr-menu/TableSelectionModal', () => ({ default: () => null }));

import SubdomainCartPage from './SubdomainCartPage';

beforeEach(() => {
  vi.clearAllMocks();
  ensureCustomerSession.mockResolvedValue(MINTED_SESSION);
  geo = { latitude: 1, longitude: 2, loading: false };
  getCurrentPosition.mockResolvedValue({ latitude: 1, longitude: 2 });
  cart = {
    items: [{ product: { id: 'p2' }, quantity: 1, modifiers: [], notes: '' }],
    sessionId: null,
    tableId: null,
    clearCart,
    setTableId: vi.fn(),
  };
  menuFixture = {
    settings: {},
    tenant: { id: 'tenant-x', currency: 'TRY' },
    enableCustomerOrdering: true,
    enableTablelessMode: true,
  };
});

async function loadAndSubmit() {
  render(<SubdomainCartPage subdomain="acme" />);
  fireEvent.click(screen.getByText('load'));
  fireEvent.click(screen.getByText('submit'));
}

describe('SubdomainCartPage', () => {
  it('toasts and aborts when the server session cannot be minted (C1)', async () => {
    ensureCustomerSession.mockRejectedValue(new Error('mint down'));
    await loadAndSubmit();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('messages.operationFailed'),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('POSTs with the tenant id from the loaded menu + the MINTED session and navigates via buildQRMenuUrl', async () => {
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    // Review C1: the wire id is the server-minted 64-hex token.
    expect(body).toMatchObject({ tenantId: 'tenant-x', sessionId: MINTED_SESSION });

    await waitFor(() => expect(clearCart).toHaveBeenCalled());
    // FH5: the session id is a bearer credential and is NOT passed into the
    // navigation URL builder anymore.
    expect(buildQRMenuUrl).toHaveBeenCalledWith(
      'orders',
      expect.objectContaining({ subdomain: 'acme', tableId: 'tbl-9' }),
    );
    expect(
      (buildQRMenuUrl.mock.calls[0][1] as Record<string, unknown>).sessionId,
    ).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith('/built-orders-url');
  });

  it('threads the typed order-level notes into the POST body (C4)', async () => {
    post.mockResolvedValue({ data: {} });
    render(<SubdomainCartPage subdomain="acme" />);
    fireEvent.click(screen.getByText('load'));
    fireEvent.click(screen.getByText('type-notes'));
    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.notes).toBe('no pickles');
  });

  it('two rapid submit taps produce exactly ONE POST (C6 latch)', async () => {
    ensureCustomerSession.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(MINTED_SESSION), 20)),
    );
    post.mockResolvedValue({ data: {} });
    render(<SubdomainCartPage subdomain="acme" />);
    fireEvent.click(screen.getByText('load'));
    fireEvent.click(screen.getByText('submit'));
    fireEvent.click(screen.getByText('submit'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe('SubdomainCartPage — location gate', () => {
  /** Browser refuses/cannot supply a fix. */
  function denyLocation() {
    geo = { latitude: null, longitude: null, loading: false };
    getCurrentPosition.mockResolvedValue(null);
  }

  it('does NOT post an order it cannot locate, and says so in the guest locale', async () => {
    // A tenant with coordinates on file 400s a positionless order with a
    // hardcoded Turkish sentence, which the diner then read on an English UI.
    denyLocation();
    await loadAndSubmit();

    await waitFor(() =>
      expect(screen.getByText('cart.location.unavailable')).toBeInTheDocument(),
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('retrying location clears the notice and the next submit carries the fix', async () => {
    denyLocation();
    render(<SubdomainCartPage subdomain="acme" />);
    fireEvent.click(screen.getByText('load'));
    const notice = await screen.findByText('cart.location.unavailable');
    expect(notice).toBeInTheDocument();

    getCurrentPosition.mockResolvedValue({ latitude: 41.01, longitude: 28.97 });
    post.mockResolvedValue({ data: {} });
    fireEvent.click(screen.getByText('cart.location.retry'));
    await waitFor(() =>
      expect(screen.queryByText('cart.location.unavailable')).toBeNull(),
    );

    fireEvent.click(screen.getByText('submit'));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body).toMatchObject({ latitude: 41.01, longitude: 28.97 });
  });

  it('lets the guest order without a position once they choose to', async () => {
    // Most tenants set no coordinates at all and never geofence; refusing to
    // submit forever would invent a requirement the server does not have.
    denyLocation();
    post.mockResolvedValue({ data: {} });
    render(<SubdomainCartPage subdomain="acme" />);
    fireEvent.click(screen.getByText('load'));
    fireEvent.click(await screen.findByText('cart.location.orderAnyway'));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.latitude).toBeUndefined();
    expect(body.longitude).toBeUndefined();
  });

  it('sends coordinates at 0,0 instead of dropping them', async () => {
    // `orderLat || undefined` erased a real position on the equator / prime
    // meridian, turning a locatable order into a positionless one.
    geo = { latitude: 0, longitude: 0, loading: false };
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body.latitude).toBe(0);
    expect(body.longitude).toBe(0);
  });
});
