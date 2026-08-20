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
// getApiErrorMessage (via the onError handlers) imports i18n/config, which
// would eagerly init i18next with all namespaces and make the key-based
// assertions resolve to real English copy. Stub it to a key-echo no-op so the
// global test-setup i18next instance (errors/common/auth only) stays active.
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));
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

const UZ_TAX_ID_RULES = [
  { name: 'STIR', pattern: '^\\d{9}$', labelKey: 'country.taxId.stir' },
  { name: 'PINFL', pattern: '^\\d{14}$', labelKey: 'country.taxId.pinfl' },
];

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

  // Task 7: currency stops being a user choice — it is DERIVED from the
  // tenant's country (CountryService.currencyForTenant()), so the picker is
  // gone. This is the one visible change for a TR tenant.
  it('shows the currency as read-only, derived text — no picker, nothing to save', () => {
    render(<BrandingSettingsPage />);
    expect(screen.getByText('TRY')).toBeInTheDocument();
    expect(screen.queryByTestId('currency-select')).not.toBeInTheDocument();
    expect(screen.queryByText('save:currencySettings.title')).not.toBeInTheDocument();
  });

  it('does not constrain the input with a fixed HTML pattern (validation is country-dependent)', () => {
    render(<BrandingSettingsPage />);
    const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
    expect(input).not.toHaveAttribute('pattern');
  });

  // UZ tenant: STIR(9)/PINFL(14), NOT the Turkish VKN(10)/TCKN(11) — before
  // this task every one of these was rejected regardless of what was typed.
  describe('under a UZ tenant', () => {
    beforeEach(() => {
      h.tenant.data = {
        // The tenant-settings response DERIVES currency from the country
        // profile (tenants.service.ts#findSettings), so a real UZ tenant's
        // `currency` is 'UZS', never the TR mirror.
        currency: 'UZS',
        taxId: '',
        countryCode: 'UZ',
        taxIdRules: UZ_TAX_ID_RULES,
      };
    });

    it("shows the tenant's OWN currency (UZS) read-only, not Turkey's", () => {
      render(<BrandingSettingsPage />);
      expect(screen.getByText('UZS')).toBeInTheDocument();
    });

    it('widens maxLength to fit the 14-digit PINFL instead of the TR-sized 11', () => {
      render(<BrandingSettingsPage />);
      const input = screen.getByPlaceholderText(
        'brandingSettings.taxId.placeholder',
      ) as HTMLInputElement;
      expect(input.maxLength).toBe(14);
    });

    it('rejects the Turkish 10-digit shape and does not call the mutation', () => {
      render(<BrandingSettingsPage />);
      const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
      fireEvent.change(input, { target: { value: '1234567890' } });
      fireEvent.click(screen.getByText('save:brandingSettings.taxId.title'));
      expect(screen.getByText('brandingSettings.taxId.formatError')).toBeInTheDocument();
      expect(h.update).not.toHaveBeenCalled();
    });

    it('ACCEPTS a 9-digit STIR', () => {
      render(<BrandingSettingsPage />);
      const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
      fireEvent.change(input, { target: { value: '123456789' } });
      fireEvent.click(screen.getByText('save:brandingSettings.taxId.title'));
      expect(h.update).toHaveBeenCalledWith(
        { taxId: '123456789' },
        expect.any(Object),
      );
    });

    it('ACCEPTS a 14-digit PINFL', () => {
      render(<BrandingSettingsPage />);
      const input = screen.getByPlaceholderText('brandingSettings.taxId.placeholder');
      fireEvent.change(input, { target: { value: '12345678901234' } });
      fireEvent.click(screen.getByText('save:brandingSettings.taxId.title'));
      expect(h.update).toHaveBeenCalledWith(
        { taxId: '12345678901234' },
        expect.any(Object),
      );
    });
  });
});
