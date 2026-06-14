import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18next from 'i18next';
import enSettings from '../../i18n/locales/en/settings.json';
import type { SmsSettings } from '../../features/sms/smsSettingsApi';

// ── Mocks ────────────────────────────────────────────────────────────────
// The page's real logic is: a loading guard, hydrating local state from the
// fetched settings with `?? true` defaulting for the per-event email
// toggles, disabling the SMS toggles when the master switch is off, and
// firing the autosave with the *merged* next state on every change. We mock
// the data + autosave hooks so those branches run deterministically.

const getSmsSettings = vi.fn();
const setValue = vi.fn();
const retry = vi.fn();

vi.mock('../../features/sms/smsSettingsApi', () => ({
  useGetSmsSettings: () => getSmsSettings(),
  useUpdateSmsSettings: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: () => ({ status: 'idle', setValue, retry }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SmsSettingsPage from './SmsSettingsPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'settings', enSettings, true, true);
});

const fullSettings: SmsSettings = {
  id: 's1',
  tenantId: 't1',
  isEnabled: true,
  smsOnReservationCreated: true,
  smsOnReservationConfirmed: true,
  smsOnReservationRejected: true,
  smsOnReservationCancelled: true,
  emailOnReservationCreated: true,
  emailOnReservationConfirmed: true,
  emailOnReservationRejected: true,
  emailOnReservationCancelled: true,
  smsOnOrderCreated: true,
  smsOnOrderApproved: true,
  smsOnOrderPreparing: true,
  smsOnOrderReady: true,
  smsOnOrderCancelled: true,
};

/** Find the SettingsToggle row whose label text matches, return its switch. */
function switchForLabel(label: string): HTMLElement {
  // Toggle labels render as <p>; section titles render as <h3>. Filter to the
  // <p> so "Enable SMS Notifications" (also a section title) resolves to the
  // actual toggle row. Structure: <div row><div(label/desc)/><button switch/></div>.
  const labelNode = screen
    .getAllByText(label)
    .find((el) => el.tagName === 'P') as HTMLElement;
  const row = labelNode.parentElement?.parentElement as HTMLElement;
  return within(row).getByRole('switch');
}

beforeEach(() => {
  getSmsSettings.mockReset();
  setValue.mockReset();
});

describe('SmsSettingsPage', () => {
  it('shows the loading state and no toggles while fetching', () => {
    getSmsSettings.mockReturnValue({ data: undefined, isLoading: true });
    render(<SmsSettingsPage />);
    expect(screen.getByText('Loading SMS settings...')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('renders all sections once loaded', () => {
    getSmsSettings.mockReturnValue({ data: fullSettings, isLoading: false });
    render(<SmsSettingsPage />);
    expect(screen.getByText('SMS Notification Settings')).toBeInTheDocument();
    // 1 master + 4 reservation SMS + 4 reservation email + 5 order SMS = 14
    expect(screen.getAllByRole('switch')).toHaveLength(14);
  });

  it('disables the SMS event toggles when the master switch is off', () => {
    getSmsSettings.mockReturnValue({
      data: { ...fullSettings, isEnabled: false },
      isLoading: false,
    });
    render(<SmsSettingsPage />);
    // "New Reservation" (SMS) is disabled because isEnabled=false.
    expect(switchForLabel('New Reservation')).toBeDisabled();
    expect(switchForLabel('New Order')).toBeDisabled();
  });

  it('keeps the email-channel toggles enabled regardless of the master switch', () => {
    getSmsSettings.mockReturnValue({
      data: { ...fullSettings, isEnabled: false },
      isLoading: false,
    });
    render(<SmsSettingsPage />);
    // Email channel "On created" is not gated by isEnabled.
    expect(switchForLabel('On created')).not.toBeDisabled();
  });

  it('defaults undefined email toggles to ON via `?? true` when hydrating', () => {
    const noEmailFlags = { ...fullSettings };
    // Simulate a backend payload missing the newer emailOn* fields.
    delete (noEmailFlags as Partial<SmsSettings>).emailOnReservationCreated;
    getSmsSettings.mockReturnValue({ data: noEmailFlags, isLoading: false });
    render(<SmsSettingsPage />);
    // Despite the field being absent, the toggle hydrates to checked.
    expect(switchForLabel('On created')).toHaveAttribute('aria-checked', 'true');
  });

  it('fires autosave with the merged next-state when a toggle flips off', () => {
    getSmsSettings.mockReturnValue({ data: fullSettings, isLoading: false });
    render(<SmsSettingsPage />);

    // Flip the master toggle off.
    fireEvent.click(switchForLabel('Enable SMS Notifications'));

    expect(setValue).toHaveBeenCalledTimes(1);
    const merged = setValue.mock.calls[0][0];
    // The flipped field changed; the rest of the state is preserved.
    expect(merged.isEnabled).toBe(false);
    expect(merged.smsOnReservationCreated).toBe(true);
    expect(merged.emailOnReservationCreated).toBe(true);
  });
});
