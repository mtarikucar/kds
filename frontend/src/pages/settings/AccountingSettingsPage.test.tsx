import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const TR_TAX_ID_RULES = [
  { name: 'VKN', pattern: '^\\d{10}$', labelKey: 'country.taxId.vkn' },
  { name: 'TCKN', pattern: '^\\d{11}$', labelKey: 'country.taxId.tckn' },
];
const UZ_TAX_ID_RULES = [
  { name: 'STIR', pattern: '^\\d{9}$', labelKey: 'country.taxId.stir' },
  { name: 'PINFL', pattern: '^\\d{14}$', labelKey: 'country.taxId.pinfl' },
];

const h = vi.hoisted(() => ({
  accounting: { data: undefined as any, isLoading: false },
  updateAsync: vi.fn(),
  testConnection: vi.fn(),
  triggerSave: vi.fn(),
  flushSave: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  // The REAL saveSettings callback the page hands to useAutoSave — captured
  // so the hold-back tests can invoke it with the state a change produced.
  saveFn: undefined as undefined | ((state: unknown) => Promise<void>),
  countryProfile: {
    countryCode: 'TR',
    taxRates: [0, 1, 10, 20],
    defaultTaxRate: 10,
    taxIdRules: [] as { name: string; pattern: string; labelKey: string }[],
  },
}));

vi.mock('../../hooks/useCountryProfile', () => ({
  useCountryProfile: () => h.countryProfile,
  isValidTaxId: (value: string, rules: { pattern: string }[]) =>
    typeof value === 'string' && value.length > 0 && rules.some((r) => new RegExp(r.pattern).test(value)),
  taxIdMaxLength: (rules: { pattern: string }[]) => {
    const lens = rules.map((r) => Number(r.pattern.match(/\{(\d+)\}/)?.[1] ?? 0));
    const max = lens.length ? Math.max(...lens) : 0;
    return max > 0 ? max : 20;
  },
}));

vi.mock('../../features/accounting/accountingApi', () => ({
  useGetAccountingSettings: () => h.accounting,
  useUpdateAccountingSettings: () => ({ mutateAsync: h.updateAsync }),
  useTestAccountingConnection: () => ({
    mutateAsync: h.testConnection,
    isPending: false,
  }),
  // SyncStatusCard renders null until data resolves; returning no data keeps
  // these tests focused on the settings form.
  useAccountingSyncStatus: () => ({ data: undefined }),
}));
vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: (
    _value: unknown,
    saveFn: (state: unknown) => Promise<void>,
  ) => {
    h.saveFn = saveFn;
    return {
      status: 'idle',
      setValue: h.triggerSave,
      retry: vi.fn(),
      save: h.flushSave,
    };
  },
}));
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));
vi.mock('../../components/settings/SettingsSection', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SettingsDivider: () => <hr />,
  SettingsGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('../../components/settings/SettingsToggle', () => ({
  // Toggle mock is clickable so tests can drive a real handleChange →
  // triggerSave round-trip (the payload hold-back tests need a change event).
  SettingsToggle: ({
    label,
    checked,
    onChange,
  }: {
    label: string;
    checked?: boolean;
    onChange?: (checked: boolean) => void;
  }) => <button onClick={() => onChange?.(!checked)}>{label}</button>,
  SettingsSelect: ({ label }: { label: string }) => <div>{label}</div>,
  SettingsInput: ({ label }: { label: string }) => <div>{label}</div>,
}));

import AccountingSettingsPage from './AccountingSettingsPage';

beforeEach(() => {
  h.accounting.data = { provider: 'NONE' };
  h.accounting.isLoading = false;
  h.countryProfile = {
    countryCode: 'TR',
    taxRates: [0, 1, 10, 20],
    defaultTaxRate: 10,
    taxIdRules: TR_TAX_ID_RULES,
  };
  h.testConnection.mockReset();
  h.flushSave.mockReset();
  h.flushSave.mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.triggerSave.mockReset();
  h.updateAsync.mockReset();
  h.updateAsync.mockResolvedValue(undefined);
  h.saveFn = undefined;
});

describe('AccountingSettingsPage', () => {
  it('shows the loading state', () => {
    h.accounting.isLoading = true;
    render(<AccountingSettingsPage />);
    expect(screen.getByText('accounting.loading')).toBeInTheDocument();
  });

  it('renders the page heading', () => {
    render(<AccountingSettingsPage />);
    expect(
      screen.getByRole('heading', { name: 'accounting.title' }),
    ).toBeInTheDocument();
  });

  it('hides the test-connection button when no provider is selected', () => {
    render(<AccountingSettingsPage />);
    expect(
      screen.queryByText('accounting.testConnection'),
    ).not.toBeInTheDocument();
  });

  it('toasts success when the connection test passes', async () => {
    h.accounting.data = { provider: 'PARASUT' };
    h.testConnection.mockResolvedValue({ success: true });
    render(<AccountingSettingsPage />);
    await userEvent.click(screen.getByText('accounting.testConnection'));
    expect(h.testConnection).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith('accounting.testSuccess');
  });

  it('toasts the failure (with error detail) when the test fails', async () => {
    h.accounting.data = { provider: 'PARASUT' };
    h.testConnection.mockResolvedValue({ success: false, error: 'bad creds' });
    render(<AccountingSettingsPage />);
    await userEvent.click(screen.getByText('accounting.testConnection'));
    expect(h.toastError).toHaveBeenCalledWith(
      expect.stringContaining('bad creds'),
    );
  });

  it('flushes the pending autosave BEFORE probing the connection (no stale-creds test)', async () => {
    // The probe validates the credentials stored in the DB; without the flush
    // a click inside the 500ms debounce window tested the PREVIOUS values.
    h.accounting.data = { provider: 'PARASUT' };
    h.testConnection.mockResolvedValue({ success: true });
    render(<AccountingSettingsPage />);
    await userEvent.click(screen.getByText('accounting.testConnection'));
    expect(h.flushSave).toHaveBeenCalledTimes(1);
    expect(h.flushSave.mock.invocationCallOrder[0]).toBeLessThan(
      h.testConnection.mock.invocationCallOrder[0],
    );
  });

  describe('nilveraApiUrl hold-back (unconfigured tenant must still be able to save)', () => {
    // The backend DTO 400s on any nilveraApiUrl that isn't https://*.nilvera.com
    // — including the '' this page hydrates when Nilvera was never configured.
    // saveSettings PATCHes full state, so without the hold-back EVERY autosave
    // on the page (a toggle flip, a company-name edit) failed for such tenants.
    async function changeToggleAndSave() {
      render(<AccountingSettingsPage />);
      await userEvent.click(screen.getByText('accounting.autoGenerateInvoice'));
      expect(h.triggerSave).toHaveBeenCalled();
      const state =
        h.triggerSave.mock.calls[h.triggerSave.mock.calls.length - 1][0];
      expect(h.saveFn).toBeDefined();
      await h.saveFn!(state);
      expect(h.updateAsync).toHaveBeenCalledTimes(1);
      return h.updateAsync.mock.calls[0][0] as Record<string, unknown>;
    }

    it("omits nilveraApiUrl from the payload when it hydrated to '' (unconfigured tenant)", async () => {
      h.accounting.data = { provider: 'NILVERA' }; // no stored nilveraApiUrl
      const payload = await changeToggleAndSave();
      expect(payload).not.toHaveProperty('nilveraApiUrl');
      // The actual change still goes through.
      expect(payload.autoGenerateInvoice).toBe(true);
    });

    it('omits a half-typed nilveraApiUrl (non-matching value) from the payload', async () => {
      h.accounting.data = {
        provider: 'NILVERA',
        nilveraApiUrl: 'https://api.nilv',
      };
      const payload = await changeToggleAndSave();
      expect(payload).not.toHaveProperty('nilveraApiUrl');
    });

    it('passes a valid https://*.nilvera.com URL through unchanged', async () => {
      h.accounting.data = {
        provider: 'NILVERA',
        nilveraApiUrl: 'https://apitest.nilvera.com',
      };
      const payload = await changeToggleAndSave();
      expect(payload.nilveraApiUrl).toBe('https://apitest.nilvera.com');
    });
  });

  // companyTaxId used to be validated against a fixed VKN(10)/TCKN(11)
  // pattern — before this, a UZ tenant's own STIR(9)/PINFL(14) was rejected
  // no matter what was typed, and a TR-shaped value was silently ACCEPTED
  // for a UZ tenant (wrong-country false positive).
  describe('companyTaxId is country-scoped', () => {
    function getCompanyTaxIdInput(): HTMLInputElement {
      const input = document.querySelector('input[inputmode="numeric"]');
      if (!input) throw new Error('companyTaxId input not found');
      return input as HTMLInputElement;
    }

    it('does not constrain the input with a fixed HTML pattern (validation is country-dependent)', () => {
      render(<AccountingSettingsPage />);
      expect(getCompanyTaxIdInput()).not.toHaveAttribute('pattern');
    });

    it('sizes maxLength to the TR profile (11, from TCKN)', () => {
      render(<AccountingSettingsPage />);
      expect(getCompanyTaxIdInput().maxLength).toBe(11);
    });

    it('widens maxLength to the UZ profile (14, from PINFL)', () => {
      h.countryProfile = {
        countryCode: 'UZ',
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_TAX_ID_RULES,
      };
      render(<AccountingSettingsPage />);
      expect(getCompanyTaxIdInput().maxLength).toBe(14);
    });

    it('shows no inline error for a 10-digit VKN under a TR tenant', () => {
      h.accounting.data = { provider: 'NONE', companyTaxId: '' };
      render(<AccountingSettingsPage />);
      fireEvent.change(getCompanyTaxIdInput(), { target: { value: '1234567890' } });
      expect(screen.queryByText(/accounting\.taxIdError/)).not.toBeInTheDocument();
    });

    it('shows an inline error for a 9-digit value under a TR tenant (not a valid VKN/TCKN)', () => {
      h.accounting.data = { provider: 'NONE', companyTaxId: '' };
      render(<AccountingSettingsPage />);
      fireEvent.change(getCompanyTaxIdInput(), { target: { value: '123456789' } });
      expect(screen.getByText(/accounting\.taxIdError/)).toBeInTheDocument();
    });

    it('ACCEPTS a 9-digit STIR under a UZ tenant (no inline error)', () => {
      h.accounting.data = { provider: 'NONE', companyTaxId: '' };
      h.countryProfile = {
        countryCode: 'UZ',
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_TAX_ID_RULES,
      };
      render(<AccountingSettingsPage />);
      fireEvent.change(getCompanyTaxIdInput(), { target: { value: '123456789' } });
      expect(screen.queryByText(/accounting\.taxIdError/)).not.toBeInTheDocument();
    });

    it('rejects the Turkish 10-digit shape under a UZ tenant (inline error)', () => {
      h.accounting.data = { provider: 'NONE', companyTaxId: '' };
      h.countryProfile = {
        countryCode: 'UZ',
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_TAX_ID_RULES,
      };
      render(<AccountingSettingsPage />);
      fireEvent.change(getCompanyTaxIdInput(), { target: { value: '1234567890' } });
      expect(screen.getByText(/accounting\.taxIdError/)).toBeInTheDocument();
    });

    it('holds back an invalid companyTaxId from the autosave payload under a UZ tenant', async () => {
      h.accounting.data = { provider: 'NONE', companyTaxId: '' };
      h.countryProfile = {
        countryCode: 'UZ',
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_TAX_ID_RULES,
      };
      render(<AccountingSettingsPage />);
      // A TR-shaped 10-digit value is invalid for a UZ tenant — the
      // autosave must not PATCH it through.
      fireEvent.change(getCompanyTaxIdInput(), { target: { value: '1234567890' } });
      expect(h.triggerSave).toHaveBeenCalled();
      const state = h.triggerSave.mock.calls[h.triggerSave.mock.calls.length - 1][0];
      await h.saveFn!(state);
      expect(h.updateAsync).toHaveBeenCalledTimes(1);
      const payload = h.updateAsync.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('companyTaxId');
    });

    it('lets a valid 9-digit STIR through the autosave payload under a UZ tenant', async () => {
      h.accounting.data = { provider: 'NONE', companyTaxId: '' };
      h.countryProfile = {
        countryCode: 'UZ',
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_TAX_ID_RULES,
      };
      render(<AccountingSettingsPage />);
      fireEvent.change(getCompanyTaxIdInput(), { target: { value: '123456789' } });
      expect(h.triggerSave).toHaveBeenCalled();
      const state = h.triggerSave.mock.calls[h.triggerSave.mock.calls.length - 1][0];
      await h.saveFn!(state);
      expect(h.updateAsync).toHaveBeenCalledTimes(1);
      const payload = h.updateAsync.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.companyTaxId).toBe('123456789');
    });
  });
});
