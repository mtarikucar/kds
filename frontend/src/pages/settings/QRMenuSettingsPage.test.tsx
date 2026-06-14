import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  posSettings: { data: undefined as any, isLoading: false },
  updateAsync: vi.fn(),
  triggerSave: vi.fn(),
  retry: vi.fn(),
  autoSaveStatus: 'idle',
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../features/pos/posApi', () => ({
  useGetPosSettings: () => h.posSettings,
  useUpdatePosSettings: () => ({ mutateAsync: h.updateAsync }),
}));
vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: () => ({
    status: h.autoSaveStatus,
    setValue: h.triggerSave,
    retry: h.retry,
  }),
}));
vi.mock('sonner', () => ({
  toast: {
    info: (m: string) => h.toastInfo(m),
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));
// Child panels have their own coverage; stub to isolate the page logic.
vi.mock('../../components/settings/LocationSettings', () => ({
  default: () => <div data-testid="location-settings" />,
}));
vi.mock('../../components/settings/WifiSocialSettings', () => ({
  default: () => <div data-testid="wifi-social-settings" />,
}));
// SettingsToggle: expose a checkbox bound to label + onChange so the page's
// toggle handler runs with real arguments.
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

import QRMenuSettingsPage from './QRMenuSettingsPage';

beforeEach(() => {
  h.posSettings.data = {
    enableCustomerOrdering: false,
    enableTwoStepCheckout: false,
  };
  h.posSettings.isLoading = false;
  h.updateAsync.mockReset();
  h.triggerSave.mockReset();
  h.toastInfo.mockReset();
});

describe('QRMenuSettingsPage', () => {
  it('shows the loading state', () => {
    h.posSettings.isLoading = true;
    render(<QRMenuSettingsPage />);
    expect(screen.getByText('posSettings.loading')).toBeInTheDocument();
  });

  it('renders the heading and child panels', () => {
    render(<QRMenuSettingsPage />);
    expect(
      screen.getByRole('heading', { name: 'qrMenuSettings.title' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('location-settings')).toBeInTheDocument();
    expect(screen.getByTestId('wifi-social-settings')).toBeInTheDocument();
  });

  it('auto-enables two-step checkout and saves when customer ordering is turned on', () => {
    render(<QRMenuSettingsPage />);
    const toggle = screen.getByRole('checkbox', {
      name: 'enableCustomerOrdering.title',
    });
    fireEvent.click(toggle);
    // Auto-enable side effect notifies the user...
    expect(h.toastInfo).toHaveBeenCalledWith('twoStepCheckout.autoEnabled');
    // ...and persists both flags together.
    expect(h.triggerSave).toHaveBeenCalledWith({
      enableCustomerOrdering: true,
      enableTwoStepCheckout: true,
    });
  });
});
