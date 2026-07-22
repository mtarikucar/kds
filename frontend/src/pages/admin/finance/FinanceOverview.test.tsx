import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

declare global {
  // eslint-disable-next-line no-var
  var __features: string[];
  // eslint-disable-next-line no-var
  var __integrations: string[];
  // eslint-disable-next-line no-var
  var __sessions: unknown;
  // eslint-disable-next-line no-var
  var __xreports: Record<string, { expectedCash: number }>;
}

vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({
    hasFeature: (k: string) => globalThis.__features.includes(k),
    hasIntegration: (d: string) => globalThis.__integrations.includes(d),
  }),
}));
vi.mock('../../../features/cash/cashApi', () => ({
  useCashierSessions: () => globalThis.__sessions,
}));
vi.mock('@tanstack/react-query', () => ({
  useQueries: ({ queries }: { queries: { queryKey: unknown[] }[] }) =>
    queries.map((q) => ({
      data: globalThis.__xreports[String((q.queryKey as string[])[2])],
      isLoading: false,
    })),
}));
vi.mock('../../../features/fiscal/fiscalApi', () => ({
  useListFiscalDevices: () => ({ data: [{ id: 'd1', status: 'online', providerId: 'fiscal_paygo', serial: 'S1' }], isError: false }),
  useListPendingReceipts: () => ({ data: [{ id: 'r1' }], isError: false }),
}));
vi.mock('../../../features/accounting/accountingApi', () => ({
  useAccountingSyncStatus: () => ({ data: { failed: 2 } }),
}));
vi.mock('../../../features/payment-terminal/paymentTerminalApi', () => ({
  useTerminalReconciliation: () => ({ data: [] }),
}));
vi.mock('../../../features/reports/reportsApi', () => ({
  useSalesReport: () => ({ data: { totalSales: 1234 }, isLoading: false, isError: false }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('react-router-dom', () => ({ Link: (p: { to: string; children: React.ReactNode }) => <a href={p.to}>{p.children}</a> }));

import FinanceOverview from './FinanceOverview';

describe('FinanceOverview', () => {
  it('kasa + gönderilemeyen belge sayacı + yazarkasa durumu; satış kartı feature ile', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__integrations = ['fiscal', 'accounting'];
    globalThis.__sessions = { data: [{ id: 's1', openedAt: new Date().toISOString(), openingFloat: '100' }], isLoading: false };
    globalThis.__xreports = { s1: { expectedCash: 4250 } };
    render(<FinanceOverview onNavigate={() => {}} />);
    expect(screen.getByText('₺4250')).toBeTruthy();      // beklenen nakit
    expect(screen.getByText('3')).toBeTruthy();           // 2 FAILED e-Belge + 1 bekleyen fiş
    expect(screen.getByText('₺1234')).toBeTruthy();       // bugünkü satış
  });

  it('advancedReports yoksa satış kartı hiç render edilmez; fiscal yoksa upsell', () => {
    globalThis.__features = [];
    globalThis.__integrations = [];
    globalThis.__sessions = { data: [], isLoading: false };
    globalThis.__xreports = {};
    render(<FinanceOverview onNavigate={() => {}} />);
    expect(screen.queryByText('₺1234')).toBeNull();
    expect(screen.getByText(/eklenti|add-on|Mağaza/i)).toBeTruthy();
  });

  it('dünden kalan açık vardiya uyarısı aksiyonla gelir', () => {
    globalThis.__features = [];
    globalThis.__integrations = [];
    globalThis.__sessions = {
      data: [{ id: 'old', openedAt: '2020-01-01T10:00:00Z', openingFloat: '0' }],
      isLoading: false,
    };
    globalThis.__xreports = { old: { expectedCash: 10 } };
    const nav = vi.fn();
    render(<FinanceOverview onNavigate={nav} />);
    fireEvent.click(screen.getByRole('button', { name: /kapat|close/i }));
    expect(nav).toHaveBeenCalledWith('cash');
  });
});
