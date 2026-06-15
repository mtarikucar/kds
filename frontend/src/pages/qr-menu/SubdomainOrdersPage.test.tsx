import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Specs for SubdomainOrdersPage — subdomain variant of the order tracking
 * screen. tenantId comes from the loaded menu data and browse-menu builds
 * its URL via buildQRMenuUrl(subdomain). We assert the waiter/bill POSTs
 * use the menu's tenant id, the table guard on call-waiter, and the
 * subdomain-aware browse navigation.
 */

const get = vi.fn().mockResolvedValue({ data: [] });
const post = vi.fn();
vi.mock('axios', () => ({
  default: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
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
let tableIdParam: string | null = 'tbl-2';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useSearchParams: () => [{ get: () => tableIdParam }],
  };
});

const buildQRMenuUrl = vi.fn((..._a: unknown[]) => '/built-menu-url');
vi.mock('../../utils/subdomain', () => ({ buildQRMenuUrl: (...a: unknown[]) => buildQRMenuUrl(...a) }));

vi.mock('../../components/qr-menu/OrdersContent', () => ({
  default: (props: any) => (
    <div>
      <button onClick={props.onCallWaiter}>call</button>
      <button onClick={props.onRequestBill}>bill</button>
      <button onClick={props.onBrowseMenu}>browse</button>
    </div>
  ),
}));
vi.mock('../../components/qr-menu/SelfPayModal', () => ({ default: () => null }));

let menuFixture: any;
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, onMenuDataLoaded, onSessionIdChange }: any) => (
    <div>
      <button onClick={() => { onSessionIdChange('sess-7'); onMenuDataLoaded(menuFixture); }}>load</button>
      {children}
    </div>
  ),
}));

import SubdomainOrdersPage from './SubdomainOrdersPage';

beforeEach(() => {
  vi.clearAllMocks();
  tableIdParam = 'tbl-2';
  menuFixture = { settings: {}, tenant: { id: 'tenant-z' }, enableCustomerSelfPay: false };
});

function load() {
  render(<SubdomainOrdersPage subdomain="bistro" />);
  fireEvent.click(screen.getByText('load'));
}

describe('SubdomainOrdersPage', () => {
  it('POSTs a waiter-request using the menu tenant id', async () => {
    post.mockResolvedValue({ data: {} });
    load();
    fireEvent.click(screen.getByText('call'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/waiter-requests'),
      { tenantId: 'tenant-z', tableId: 'tbl-2', sessionId: 'sess-7' },
    ));
  });

  it('guards the waiter call when no table is present', () => {
    tableIdParam = null;
    load();
    fireEvent.click(screen.getByText('call'));
    expect(toastError).toHaveBeenCalledWith('waiter.noTable');
  });

  it('POSTs a bill-request for the session', async () => {
    post.mockResolvedValue({ data: {} });
    load();
    fireEvent.click(screen.getByText('bill'));
    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/bill-requests'),
      { tenantId: 'tenant-z', tableId: 'tbl-2', sessionId: 'sess-7' },
    ));
  });

  it('browses the menu via buildQRMenuUrl(subdomain)', () => {
    load();
    fireEvent.click(screen.getByText('browse'));
    expect(buildQRMenuUrl).toHaveBeenCalledWith('menu', expect.objectContaining({ subdomain: 'bistro' }));
    expect(navigate).toHaveBeenCalledWith('/built-menu-url');
  });
});
