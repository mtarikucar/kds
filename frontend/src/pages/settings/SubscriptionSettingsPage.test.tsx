import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SubscriptionSettingsPage from './SubscriptionSettingsPage';

// The current-subscription card must show the plan's LIVE catalog price, not the
// subscription's frozen `amount`. That snapshot drifts when a plan is re-priced
// and twice showed a stale figure to users ("$199.99", then "₺79.99" while the
// live Business plan was ₺7.999). This guards the regression.

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k) }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Frozen amount 79.99 ≠ live plan price 7999 — the whole point of the test.
const SUB = {
  id: 's1',
  tenantId: 't1',
  planId: 'p1',
  status: 'ACTIVE',
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

describe('SubscriptionSettingsPage current-plan price', () => {
  it("renders the plan's live catalog price (₺7999.00), not the frozen amount", () => {
    render(<SubscriptionSettingsPage />);
    expect(screen.getByText(/₺7999\.00/)).toBeInTheDocument();
  });

  it('does not render the stale frozen subscription amount (₺79.99)', () => {
    render(<SubscriptionSettingsPage />);
    expect(screen.queryByText(/₺79\.99/)).not.toBeInTheDocument();
  });
});
