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
  useAutoSave: () => ({
    status: 'idle',
    setValue: h.triggerSave,
    retry: vi.fn(),
    save: h.flushSave,
  }),
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
  SettingsToggle: ({ label }: { label: string }) => <div>{label}</div>,
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
});
