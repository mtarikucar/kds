import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CashPage from '../CashPage';

// CashPage calls useFormatCurrency() unconditionally (not gated by tab),
// which chains to useCurrency -> react-query. Stub the currency hook so the
// page renders without a QueryClientProvider — same pattern used by
// InvoicesPage.test.tsx for the same dependency chain.
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => 'TRY',
}));
vi.mock('../../../features/cash/cashApi', () => ({
  useCashierSessions: () => ({ data: [], isLoading: false }),
  useXReport: () => ({ data: undefined, isLoading: false }),
  useCreateCashMovement: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
  useTipDistribution: () => ({ data: undefined, isLoading: false, isError: false }),
  downloadSessionsCsv: vi.fn(),
}));
vi.mock('../../../components/reports/ZReportsSection', () => ({
  default: () => <div>GUN-SONU-PANEL</div>,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: () => true, hasIntegration: () => false }),
}));

describe('CashPage — Gün Sonu sekmesi', () => {
  it('Gün Sonu sekmesi ZReportsSection render eder', () => {
    render(<CashPage />);
    fireEvent.click(screen.getByRole('button', { name: /Gün Sonu|Day-End/ }));
    expect(screen.getByText('GUN-SONU-PANEL')).toBeTruthy();
    // ÖKC-absence assertion belongs to Task 5 (that's when the okc tab is
    // actually removed from CashPage) — intentionally not asserted here.
  });
});
