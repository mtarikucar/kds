import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountingBackOfficePage from '../AccountingBackOfficePage';

// The consolidated Muhasebe page embeds the invoice + settings panels and the
// e-Belge readiness. Mock the heavy children so this test only asserts the IA:
// three tabs (Faturalar / e-Belge Durumu / Ayarlar) that switch correctly, and
// that the management-report tabs (budget/consolidated/forecast) are GONE.
vi.mock('../invoices/InvoicesPage', () => ({
  InvoicesPanel: () => <div>FATURA-PANEL</div>,
}));
vi.mock('../../settings/AccountingSettingsPage', () => ({
  AccountingSettingsPanel: () => <div>AYAR-PANEL</div>,
}));
vi.mock('../../../features/accounting/eBelgeApi', () => ({
  useEDocumentReadiness: () => ({
    data: { mukellefQuery: 'NONE', signerConfigured: false, signer: '—' },
    isLoading: false,
  }),
  useResyncFailedEDocuments: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
}));
vi.mock('../../../features/fiscal/FiscalRecoveryPage', () => ({
  default: () => <div>FIS-KURTARMA</div>,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasIntegration: (d: string) => d === 'fiscal' }),
}));

// The page went through the t() migration: labels now come from the
// `settings` namespace. This suite's import graph pulls i18n/config (via the
// shared QueryStateGate -> ErrorState -> api-error), which registers the full
// locale bundle, so t() resolves to the ENGLISH values below.
describe('Muhasebe (AccountingBackOfficePage) — consolidated tabs', () => {
  it('shows the three e-Belge tabs and defaults to Faturalar', () => {
    render(<AccountingBackOfficePage />, { wrapper: MemoryRouter });
    expect(screen.getByRole('button', { name: /Invoices/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Undelivered|Gönderilemeyen/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeTruthy();
    // default tab
    expect(screen.getByText('FATURA-PANEL')).toBeTruthy();
  });

  it('switches to the Ayarlar tab (settings panel) and the e-Belge status tab', () => {
    render(<AccountingBackOfficePage />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }));
    expect(screen.getByText('AYAR-PANEL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Undelivered|Gönderilemeyen/ }));
    expect(screen.getByText(/Go-live readiness check/)).toBeTruthy();
  });

  it('no longer hosts the management-report tabs (moved to Raporlar)', () => {
    render(<AccountingBackOfficePage />, { wrapper: MemoryRouter });
    expect(screen.queryByRole('button', { name: /Budget|Bütçe/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Consolidated|Konsolide/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Forecast|Tahmin/ })).toBeNull();
  });

  it('e-Belge sekmesi fiscal entegrasyonu varken fiş kurtarma bölümünü içerir', () => {
    render(<AccountingBackOfficePage />, { wrapper: MemoryRouter });
    fireEvent.click(screen.getByRole('button', { name: /Undelivered|Gönderilemeyen/ }));
    expect(screen.getByText('FIS-KURTARMA')).toBeTruthy();
  });

  it('?tab= query param selects the tab on mount (redirect deep links)', () => {
    render(
      <MemoryRouter initialEntries={['/admin/finance?tab=edoc']}>
        <AccountingBackOfficePage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Go-live readiness check/)).toBeTruthy();
  });

  it('?tab=settings query param selects the settings tab on mount', () => {
    render(
      <MemoryRouter initialEntries={['/admin/finance?tab=settings']}>
        <AccountingBackOfficePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('AYAR-PANEL')).toBeTruthy();
  });
});
