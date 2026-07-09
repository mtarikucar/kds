import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('Muhasebe (AccountingBackOfficePage) — consolidated tabs', () => {
  it('shows the three e-Belge tabs and defaults to Faturalar', () => {
    render(<AccountingBackOfficePage />);
    expect(screen.getByRole('button', { name: /Faturalar/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /e-Belge Durumu/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ayarlar/ })).toBeTruthy();
    // default tab
    expect(screen.getByText('FATURA-PANEL')).toBeTruthy();
  });

  it('switches to the Ayarlar tab (settings panel) and the e-Belge status tab', () => {
    render(<AccountingBackOfficePage />);
    fireEvent.click(screen.getByRole('button', { name: /Ayarlar/ }));
    expect(screen.getByText('AYAR-PANEL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /e-Belge Durumu/ }));
    expect(screen.getByText(/Canlıya-hazırlık kontrolü/)).toBeTruthy();
  });

  it('no longer hosts the management-report tabs (moved to Raporlar)', () => {
    render(<AccountingBackOfficePage />);
    expect(screen.queryByRole('button', { name: /Bütçe/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Konsolide/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tahmin/ })).toBeNull();
  });
});
