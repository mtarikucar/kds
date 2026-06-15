import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Specs for SubdomainCartPage — the subdomain variant of the QR cart
 * submit flow. Differs from CartPage in that tenantId comes from the
 * loaded menu data and the post-order navigation is built via
 * buildQRMenuUrl(subdomain). We assert the session guard, the mapped
 * order POST, and the subdomain-aware success navigation.
 */

const post = vi.fn();
vi.mock('axios', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

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

const getCurrentPosition = vi.fn().mockResolvedValue({ latitude: 1, longitude: 2 });
vi.mock('../../hooks', () => ({
  useGeolocation: () => ({ latitude: 1, longitude: 2, getCurrentPosition }),
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
  default: ({ onSubmitOrder }: any) => <button onClick={onSubmitOrder}>submit</button>,
}));
vi.mock('../../components/qr-menu/TableSelectionModal', () => ({ default: () => null }));

import SubdomainCartPage from './SubdomainCartPage';

beforeEach(() => {
  vi.clearAllMocks();
  cart = {
    items: [{ product: { id: 'p2' }, quantity: 1, modifiers: [], notes: '' }],
    sessionId: 'sess-2',
    clearCart,
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
  it('toasts and aborts when there is no session', async () => {
    cart.sessionId = null;
    await loadAndSubmit();
    expect(toastError).toHaveBeenCalledWith('cart.sessionExpired');
    expect(post).not.toHaveBeenCalled();
  });

  it('POSTs with the tenant id from the loaded menu and navigates via buildQRMenuUrl', async () => {
    post.mockResolvedValue({ data: {} });
    await loadAndSubmit();

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [string, any];
    expect(body).toMatchObject({ tenantId: 'tenant-x', sessionId: 'sess-2' });

    await waitFor(() => expect(clearCart).toHaveBeenCalled());
    expect(buildQRMenuUrl).toHaveBeenCalledWith(
      'orders',
      expect.objectContaining({ subdomain: 'acme', sessionId: 'sess-2' }),
    );
    expect(navigate).toHaveBeenCalledWith('/built-orders-url');
  });
});
