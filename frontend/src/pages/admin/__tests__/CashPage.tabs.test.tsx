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
let features: string[] = ['advancedReports'];
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => features.includes(k), hasIntegration: () => false }),
}));

describe('CashPage — Gün Sonu sekmesi', () => {
  it('Gün Sonu sekmesi ZReportsSection render eder', () => {
    features = ['advancedReports'];
    render(<CashPage />);
    fireEvent.click(screen.getByRole('button', { name: /Gün Sonu|Day-End/ }));
    expect(screen.getByText('GUN-SONU-PANEL')).toBeTruthy();
    // ÖKC sekmesi kaldırıldı (Task 5) — durum artık Genel Bakış'ta, kayıt
    // Task 6'da şube hub'ında.
    expect(screen.queryByRole('button', { name: /ÖKC/ })).toBeNull();
  });

  it('advancedReports yokken Bahşiş sekmesi GİZLİ (403-upsell çıkmazı bitti)', () => {
    features = [];
    render(<CashPage />);
    expect(screen.queryByRole('button', { name: /Bahşiş|Tips/ })).toBeNull();
  });

  it('ekranda çıplak enum yok', () => {
    features = ['advancedReports'];
    render(<CashPage />);
    fireEvent.click(screen.getByRole('button', { name: /Hareket|Movements/ }));
    expect(screen.queryByText(/SAFE_DROP/)).toBeNull();
    // The old hardcoded label leaked the raw backend enum as parenthetical
    // jargon: "Küçük kasa (petty)". The i18n label table (Task 5 brief)
    // translates it properly instead ("Petty cash" in en / "Küçük kasa" in
    // tr) — "Petty cash" is the correct English term, not a bare enum, so we
    // assert against the actual enum literal rather than the English word.
    expect(screen.queryByText(/PETTY_CASH/)).toBeNull();
  });
});
