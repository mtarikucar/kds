import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
});
