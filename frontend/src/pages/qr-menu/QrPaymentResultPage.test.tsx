import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/**
 * Specs for QrPaymentResultPage — renders the PayTR self-pay outcome. The
 * real logic: status derives from the polled pay-status (falling back to
 * the explicit `?status=failed` query param when no data yet); the
 * SUCCEEDED branch shows the paid amount + "pay the rest" only when a
 * remainder exists; the FAILED branch maps a known failureReason code to
 * a localized message; the orders URL differs for subdomain vs token
 * routing; and a fully-paid success auto-bounces to orders after 8s.
 */

let payStatus: { data: any; isError: boolean };
vi.mock('../../features/qr-menu/customerPayApi', () => ({
  useSessionPayStatus: () => payStatus,
}));

vi.mock('../../store/cartStore', () => ({
  useCartStore: (selector: any) => selector({ sessionId: 'sess-1', currency: 'TRY' }),
}));

vi.mock('../../lib/utils', () => ({ formatCurrency: (n: number, c: string) => `${c}${n}` }));

// Return the key (ignoring the inline English fallback) so assertions can
// match on the stable i18n key rather than the copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: (_t, tag: string) => ({ children, ...p }: any) => {
    const Tag = tag as any;
    const { initial, animate, transition, whileHover, whileTap, ...rest } = p;
    return <Tag {...rest}>{children}</Tag>;
  } }),
}));

const navigate = vi.fn();
let oidParam: string | null = 'oid-1';
let statusParam: string | null = null;
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<any>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigate,
    useParams: () => ({ tenantId: 't-1' }),
    useSearchParams: () => [{ get: (k: string) => (k === 'oid' ? oidParam : statusParam) }],
  };
});

import QrPaymentResultPage from './QrPaymentResultPage';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  oidParam = 'oid-1';
  statusParam = null;
  payStatus = { data: undefined, isError: false };
});

describe('QrPaymentResultPage — status derivation', () => {
  it('shows the pending/confirming state when no data has arrived yet', () => {
    render(<QrPaymentResultPage />);
    expect(screen.getByText('payment.result.checking')).toBeInTheDocument();
  });

  it('falls back to FAILED from the explicit ?status=failed query param', () => {
    statusParam = 'failed';
    render(<QrPaymentResultPage />);
    expect(screen.getByText('payment.result.failed')).toBeInTheDocument();
  });
});

describe('QrPaymentResultPage — SUCCEEDED', () => {
  it('renders the paid amount and the enjoy message when nothing remains', () => {
    payStatus = {
      data: { status: 'SUCCEEDED', amount: '50', remaining: { summary: { remainingQuantity: 0 } } },
      isError: false,
    };
    render(<QrPaymentResultPage />);
    expect(screen.getByText('payment.result.success')).toBeInTheDocument();
    expect(screen.getByText('TRY50')).toBeInTheDocument();
    expect(screen.getByText('payment.result.enjoy')).toBeInTheDocument();
    expect(screen.queryByText('payment.result.payRemaining')).toBeNull();
  });

  it('offers "pay the rest" when there is a remaining balance', () => {
    payStatus = {
      data: {
        status: 'SUCCEEDED',
        amount: '20',
        remaining: { summary: { remainingQuantity: 2, remainingAmount: '30' } },
      },
      isError: false,
    };
    render(<QrPaymentResultPage />);
    expect(screen.getByText('payment.result.payRemaining')).toBeInTheDocument();
    // Remaining amount shown via formatCurrency.
    expect(screen.getByText('TRY30')).toBeInTheDocument();
  });
});

describe('QrPaymentResultPage — FAILED failureReason mapping', () => {
  it('maps a known failure code to its localized error key', () => {
    payStatus = { data: { status: 'FAILED', failureReason: 'expired' }, isError: false };
    render(<QrPaymentResultPage />);
    expect(screen.getByText('payment.result.errors.expired')).toBeInTheDocument();
  });

  it('uses the generic detail for an unknown failure code', () => {
    payStatus = { data: { status: 'FAILED', failureReason: 'who_knows' }, isError: false };
    render(<QrPaymentResultPage />);
    expect(screen.getByText('payment.result.failedDetail')).toBeInTheDocument();
  });
});

describe('QrPaymentResultPage — navigation', () => {
  it('uses the token-route orders URL by default', () => {
    payStatus = { data: { status: 'EXPIRED' }, isError: false };
    render(<QrPaymentResultPage />);
    fireEvent.click(screen.getByText('payment.result.backToOrders'));
    expect(navigate).toHaveBeenCalledWith('/qr-menu/t-1/orders');
  });

  it('uses the relative /orders URL in subdomain mode', () => {
    payStatus = { data: { status: 'EXPIRED' }, isError: false };
    render(<QrPaymentResultPage subdomain="acme" />);
    fireEvent.click(screen.getByText('payment.result.backToOrders'));
    expect(navigate).toHaveBeenCalledWith('/orders');
  });

  it('auto-bounces to orders 8s after a fully-paid success', () => {
    vi.useFakeTimers();
    payStatus = {
      data: { status: 'SUCCEEDED', amount: '50', remaining: { summary: { remainingQuantity: 0 } } },
      isError: false,
    };
    render(<QrPaymentResultPage />);
    expect(navigate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(navigate).toHaveBeenCalledWith('/qr-menu/t-1/orders');
  });
});
