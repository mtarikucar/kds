import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubscriptionSettingsPage from './SubscriptionSettingsPage';

// The current-subscription card must show the plan's LIVE catalog price, not the
// subscription's frozen `amount`. That snapshot drifts when a plan is re-priced
// and twice showed a stale figure to users ("$199.99", then "₺79.99" while the
// live Business plan was ₺7.999). This guards the regression.

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === 'string' ? d : k) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Demo-tenant "explore demo" sessions must not be able to click through to a
// real-money checkout — the backend 403s any real-money initiation for the
// shared demo tenant (DEMO_PAYMENT_BLOCKED). Mutable so each test controls it.
let demoMode = false;
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector: (s: { demoMode: boolean }) => unknown) => selector({ demoMode }),
}));

// Frozen amount 79.99 ≠ live plan price 7999 — the whole point of the price test.
let subStatus: string = 'ACTIVE';
const SUB = {
  id: 's1',
  tenantId: 't1',
  planId: 'p1',
  get status() {
    return subStatus;
  },
  billingCycle: 'MONTHLY',
  paymentProvider: 'PAYTR',
  startDate: '2026-01-01T00:00:00.000Z',
  currentPeriodStart: '2026-06-01T00:00:00.000Z',
  currentPeriodEnd: '2026-07-01T00:00:00.000Z',
  isTrialPeriod: false,
  amount: 79.99,
  currency: 'TRY',
  cancelAtPeriodEnd: false,
  plan: { id: 'p1', name: 'BUSINESS', displayName: 'Business Plan' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};
const PLANS = [
  {
    id: 'p1',
    name: 'BUSINESS',
    displayName: 'Business Plan',
    monthlyPrice: 7999,
    yearlyPrice: 79999,
    currency: 'TRY',
    limits: { maxUsers: -1, maxTables: -1, maxProducts: -1, maxMonthlyOrders: -1 },
  },
];

vi.mock('../../features/subscriptions/subscriptionsApi', () => ({
  useGetCurrentSubscription: () => ({ data: SUB, isLoading: false, refetch: vi.fn() }),
  useGetPlans: () => ({ data: PLANS }),
  useGetTenantInvoices: () => ({ data: [], isLoading: false }),
  useCancelSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactivateSubscription: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetScheduledDowngrade: () => ({ data: null, refetch: vi.fn() }),
}));
vi.mock('../../api/paymentsApi', () => ({
  useBankTransferDetails: () => ({ data: { enabled: true } }),
}));
vi.mock('../../components/subscriptions/ScheduledDowngradeAlert', () => ({ default: () => null }));
vi.mock('../../components/subscriptions/CancelSubscriptionModal', () => ({ default: () => null }));

beforeEach(() => {
  demoMode = false;
  subStatus = 'ACTIVE';
  navigate.mockClear();
});

describe('SubscriptionSettingsPage current-plan price', () => {
  it("renders the plan's live catalog price (₺7.999,00 tr-TR), not the frozen amount", () => {
    // deep-review FM12: money now renders in app-wide tr-TR format
    // (₺7.999,00) instead of the US-style ₺7999.00.
    render(<SubscriptionSettingsPage />);
    expect(screen.getByText(/₺7\.999,00/)).toBeInTheDocument();
  });

  it('does not render the stale frozen subscription amount (₺79,99)', () => {
    render(<SubscriptionSettingsPage />);
    expect(screen.queryByText(/₺79,99/)).not.toBeInTheDocument();
  });
});

describe('SubscriptionSettingsPage — demo payment gating', () => {
  it('demoMode: the "change plan" CTA is disabled and clicking it does not navigate', () => {
    demoMode = true;
    subStatus = 'ACTIVE';
    render(<SubscriptionSettingsPage />);
    const btn = screen.getByRole('button', { name: /changePlan/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('not demoMode: the "change plan" CTA is enabled and navigates on click', () => {
    demoMode = false;
    subStatus = 'ACTIVE';
    render(<SubscriptionSettingsPage />);
    const btn = screen.getByRole('button', { name: /changePlan/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(navigate).toHaveBeenCalledWith('/subscription/change-plan');
  });

  it('demoMode: the PAST_DUE "renew now" CTA is disabled and clicking it does not navigate', () => {
    demoMode = true;
    subStatus = 'PAST_DUE';
    render(<SubscriptionSettingsPage />);
    // t() mock echoes the default-value string when one is passed (matching
    // this file's existing convention) — 'subscriptions.renewNow' has one.
    const btn = screen.getByRole('button', { name: /Şimdi yenile/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('not demoMode: the PAST_DUE "renew now" CTA is enabled and navigates on click', () => {
    demoMode = false;
    subStatus = 'PAST_DUE';
    render(<SubscriptionSettingsPage />);
    const btn = screen.getByRole('button', { name: /Şimdi yenile/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(navigate).toHaveBeenCalledWith(
      `/subscription/checkout?planId=${SUB.planId}&billingCycle=${SUB.billingCycle}`,
    );
  });

  it('demoMode: the EXPIRED "resubscribe" CTA is disabled and clicking it does not navigate', () => {
    demoMode = true;
    subStatus = 'EXPIRED';
    render(<SubscriptionSettingsPage />);
    const btn = screen.getByRole('button', { name: /Yeniden abone ol/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('not demoMode: the EXPIRED "resubscribe" CTA is enabled and navigates on click', () => {
    demoMode = false;
    subStatus = 'EXPIRED';
    render(<SubscriptionSettingsPage />);
    const btn = screen.getByRole('button', { name: /Yeniden abone ol/i });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(navigate).toHaveBeenCalledWith('/subscription/plans?renew=1');
  });
});
