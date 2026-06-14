import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  tenant: { data: undefined as any, isLoading: false },
  update: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../hooks/useCurrency', () => ({
  useGetTenantSettings: () => h.tenant,
  useUpdateTenantSettings: () => ({ mutate: h.update, isPending: false }),
  SUPPORTED_CURRENCIES: [
    { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
    { code: 'USD', name: 'US Dollar', symbol: '$' },
  ],
}));
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));
vi.mock('../../components/settings/SubdomainSettings', () => ({
  default: () => <div data-testid="subdomain-settings" />,
}));
// SettingsSection: expose the manual-save button so onSave fires.
vi.mock('../../components/settings/SettingsSection', () => ({
  SettingsSection: ({
    title,
    onSave,
    children,
  }: {
    title: string;
    onSave?: () => void;
    children: React.ReactNode;
  }) => (
    <section>
      <h2>{title}</h2>
      {children}
      {onSave && <button onClick={onSave}>save:{title}</button>}
    </section>
  ),
  SettingsGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('../../components/settings/SettingsToggle', () => ({
  SettingsSelect: ({ label }: { label: string }) => (
    <div data-testid="currency-select">{label}</div>
  ),
}));

import BrandingSettingsPage from './BrandingSettingsPage';

beforeEach(() => {
  h.tenant.data = { currency: 'TRY', taxId: '' };
  h.tenant.isLoading = false;
  h.update.mockReset();
  h.toastError.mockReset();
});

describe('BrandingSettingsPage', () => {
  it('shows the loading state', () => {
    h.tenant.isLoading = true;
    render(<BrandingSettingsPage />);
    expect(screen.getByText('posSettings.loading')).toBeInTheDocument();
  });

  it('strips non-digits from the tax id input', () => {
    render(<BrandingSettingsPage />);
    const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
    fireEvent.change(input, { target: { value: '12a34b56' } });
    expect((input as HTMLInputElement).value).toBe('123456');
  });

  it('rejects an invalid tax id length and does not call the mutation', () => {
    render(<BrandingSettingsPage />);
    const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
    fireEvent.change(input, { target: { value: '123' } }); // too short
    fireEvent.click(screen.getByText('save:brandingSettings.taxId.title'));
    expect(screen.getByText('brandingSettings.taxId.formatError')).toBeInTheDocument();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('saves a valid 10-digit tax id', () => {
    render(<BrandingSettingsPage />);
    const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
    fireEvent.change(input, { target: { value: '1234567890' } });
    fireEvent.click(screen.getByText('save:brandingSettings.taxId.title'));
    expect(h.update).toHaveBeenCalledWith(
      { taxId: '1234567890' },
      expect.any(Object),
    );
  });

  it('saves the currency selection', () => {
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByText('save:currencySettings.title'));
    expect(h.update).toHaveBeenCalledWith(
      { currency: 'TRY' },
      expect.any(Object),
    );
  });
});
