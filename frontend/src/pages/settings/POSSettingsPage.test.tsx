import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  posSettings: { data: undefined as any, isLoading: false },
  updateAsync: vi.fn(),
  triggerSave: vi.fn(),
  retry: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../../features/pos/posApi', () => ({
  useGetPosSettings: () => h.posSettings,
  useUpdatePosSettings: () => ({ mutateAsync: h.updateAsync }),
}));
vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: () => ({ status: 'idle', setValue: h.triggerSave, retry: h.retry }),
}));
vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => h.toastError(m),
    success: (m: string) => h.toastSuccess(m),
  },
}));
vi.mock('../../components/settings/SettingsToggle', () => ({
  SettingsToggle: ({
    label,
    checked,
    onChange,
  }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  ),
  SettingsSelect: ({ label }: { label: string }) => (
    <div data-testid="settings-select">{label}</div>
  ),
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

import POSSettingsPage from './POSSettingsPage';

beforeEach(() => {
  h.posSettings.data = {
    enableTablelessMode: false,
    enableTwoStepCheckout: true,
    showProductImages: true,
    enableCustomerOrdering: true,
    enableCustomerSelfPay: false,
    defaultMapView: '2d',
    requireServedForDineInPayment: false,
  };
  h.posSettings.isLoading = false;
  h.triggerSave.mockReset();
  h.toastError.mockReset();
});

describe('POSSettingsPage', () => {
  it('shows the loading state', () => {
    h.posSettings.isLoading = true;
    render(<POSSettingsPage />);
    expect(screen.getByText('posSettings.loading')).toBeInTheDocument();
  });

  it('renders the heading', () => {
    render(<POSSettingsPage />);
    expect(
      screen.getByRole('heading', { name: 'posSettings.title' }),
    ).toBeInTheDocument();
  });

  it('blocks disabling two-step checkout while customer ordering is on', () => {
    render(<POSSettingsPage />);
    const twoStep = screen.getByRole('checkbox', {
      name: 'twoStepCheckout.title',
    });
    fireEvent.click(twoStep); // attempt to turn off
    expect(h.toastError).toHaveBeenCalledWith(
      'twoStepCheckout.cannotDisableWithCustomerOrdering',
    );
    expect(h.triggerSave).not.toHaveBeenCalled();
  });

  it('saves an allowed toggle change', () => {
    render(<POSSettingsPage />);
    const tableless = screen.getByRole('checkbox', {
      name: 'enableTablelessMode',
    });
    fireEvent.click(tableless);
    expect(h.triggerSave).toHaveBeenCalledWith(
      expect.objectContaining({ enableTablelessMode: true }),
    );
  });
});
