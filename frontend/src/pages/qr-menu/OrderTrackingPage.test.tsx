import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Specs for OrderTrackingPage — the QR order status screen. We exercise
 * the action handlers it passes to OrdersContent: call-waiter requires a
 * table (toast guard) then POSTs a waiter-request; request-bill POSTs a
 * bill-request; browse-menu navigates back to the menu with the table
 * preserved; and the Pay-Now CTA is only offered when self-pay is
 * enabled AND a session exists.
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

const navigate = vi.fn();
let tableIdParam: string | null = 'tbl-5';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ tenantId: 't-1' }),
    useSearchParams: () => [{ get: () => tableIdParam }],
  };
});

let lastContentProps: any;
vi.mock('../../components/qr-menu/OrdersContent', () => ({
  default: (props: any) => {
    lastContentProps = props;
    return (
      <div>
        <button onClick={props.onCallWaiter}>call</button>
        <button onClick={props.onRequestBill}>bill</button>
        <button onClick={props.onBrowseMenu}>browse</button>
        <span data-testid="can-pay">{props.onPayNow ? 'yes' : 'no'}</span>
      </div>
    );
  },
}));
vi.mock('../../components/qr-menu/SelfPayModal', () => ({ default: () => null }));

let menuFixture: any;
vi.mock('./QRMenuLayout', () => ({
  default: ({ children, onMenuDataLoaded, onSessionIdChange }: any) => (
    <div>
      <button onClick={() => { onSessionIdChange('sess-1'); onMenuDataLoaded(menuFixture); }}>load</button>
      {children}
    </div>
  ),
}));

import OrderTrackingPage from './OrderTrackingPage';

beforeEach(() => {
  vi.clearAllMocks();
  tableIdParam = 'tbl-5';
  menuFixture = { settings: {}, tenant: { id: 't-1' }, enableCustomerSelfPay: true };
});

function load() {
  render(<OrderTrackingPage />);
  fireEvent.click(screen.getByText('load'));
}

describe('OrderTrackingPage — call waiter', () => {
  it('POSTs a waiter-request with the table + session', async () => {
    post.mockResolvedValue({ data: {} });
    load();
    fireEvent.click(screen.getByText('call'));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/customer-orders/waiter-requests'),
      { tenantId: 't-1', tableId: 'tbl-5', sessionId: 'sess-1' },
    ));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('waiter.callSuccess'));
  });

  it('blocks the waiter call with a toast when there is no table', async () => {
    tableIdParam = null;
    load();
    fireEvent.click(screen.getByText('call'));
    expect(toastError).toHaveBeenCalledWith('waiter.noTable');
    expect(post).not.toHaveBeenCalledWith(
      expect.stringContaining('/waiter-requests'),
      expect.anything(),
    );
  });
});

describe('OrderTrackingPage — request bill', () => {
  it('POSTs a bill-request for the session', async () => {
    post.mockResolvedValue({ data: {} });
    load();
    fireEvent.click(screen.getByText('bill'));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      expect.stringContaining('/customer-orders/bill-requests'),
      { tenantId: 't-1', tableId: 'tbl-5', sessionId: 'sess-1' },
    ));
  });
});

describe('OrderTrackingPage — browse menu + self-pay gate', () => {
  it('navigates back to the menu keeping the table in the URL', () => {
    load();
    fireEvent.click(screen.getByText('browse'));
    expect(navigate).toHaveBeenCalledWith('/qr-menu/t-1?tableId=tbl-5');
  });

  it('offers Pay-Now only when self-pay is enabled', () => {
    load();
    expect(screen.getByTestId('can-pay').textContent).toBe('yes');
  });

  it('hides Pay-Now when self-pay is disabled server-side', () => {
    menuFixture.enableCustomerSelfPay = false;
    load();
    expect(screen.getByTestId('can-pay').textContent).toBe('no');
  });
});
