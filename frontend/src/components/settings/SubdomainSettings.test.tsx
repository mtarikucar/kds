import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The subdomain control is DESTRUCTIVE: every outgoing name is quarantined
 * for 90 days on the backend, so a save breaks the printed QR base URL.
 * These tests pin the explicit-save contract that replaced the old 800ms
 * debounced autosave (which committed half-typed renames and silently
 * DELETED the subdomain when the field was cleared):
 *  - typing alone never persists anything;
 *  - changing/removing an existing subdomain requires the confirm dialog;
 *  - first-time set (nothing released) saves without the dialog.
 */

const h = vi.hoisted(() => ({
  settings: { data: undefined as any, isLoading: false },
  updateAsync: vi.fn(),
  hasCustomBranding: true,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../hooks/useCurrency', () => ({
  useGetTenantSettings: () => h.settings,
  useUpdateTenantSettings: () => ({
    mutateAsync: h.updateAsync,
    isPending: false,
  }),
}));
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({
    hasFeature: () => h.hasCustomBranding,
    isLoading: false,
  }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));

import SubdomainSettings from './SubdomainSettings';

const input = () =>
  screen.getByPlaceholderText('subdomain.inputPlaceholder') as HTMLInputElement;
const saveButton = () =>
  screen.getByRole('button', { name: /subdomain\.saveButton/ });
const confirmButton = () =>
  screen.getByRole('button', { name: 'subdomain.confirmAction' });

beforeEach(() => {
  h.settings.data = { subdomain: 'oldsub' };
  h.settings.isLoading = false;
  h.hasCustomBranding = true;
  h.updateAsync.mockReset();
  h.updateAsync.mockResolvedValue(undefined);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe('SubdomainSettings explicit save (no autosave)', () => {
  it('typing (and pausing) never persists anything by itself', async () => {
    render(<SubdomainSettings />);
    await userEvent.clear(input());
    await userEvent.type(input(), 'newname');
    expect(h.updateAsync).not.toHaveBeenCalled();
  });

  it('disables Save while the value is unchanged', () => {
    render(<SubdomainSettings />);
    expect(input().value).toBe('oldsub');
    expect(saveButton()).toBeDisabled();
  });

  it('renaming an existing subdomain requires the confirm dialog before saving', async () => {
    render(<SubdomainSettings />);
    await userEvent.clear(input());
    await userEvent.type(input(), 'newname');

    await userEvent.click(saveButton());
    // Dialog is up, nothing saved yet.
    expect(screen.getByText('subdomain.confirmTitle')).toBeInTheDocument();
    expect(h.updateAsync).not.toHaveBeenCalled();

    await userEvent.click(confirmButton());
    expect(h.updateAsync).toHaveBeenCalledTimes(1);
    expect(h.updateAsync).toHaveBeenCalledWith({ subdomain: 'newname' });
    expect(h.toastSuccess).toHaveBeenCalledWith('subdomain.saveSuccess');
  });

  it('clearing the field does NOT delete silently — deletion goes through the same confirm', async () => {
    render(<SubdomainSettings />);
    await userEvent.clear(input());
    expect(h.updateAsync).not.toHaveBeenCalled();

    await userEvent.click(saveButton());
    expect(screen.getByText('subdomain.confirmTitle')).toBeInTheDocument();
    expect(h.updateAsync).not.toHaveBeenCalled();

    await userEvent.click(confirmButton());
    expect(h.updateAsync).toHaveBeenCalledWith({ subdomain: null });
  });

  it('cancel closes the dialog without saving', async () => {
    render(<SubdomainSettings />);
    await userEvent.clear(input());
    await userEvent.type(input(), 'newname');
    await userEvent.click(saveButton());

    await userEvent.click(
      screen.getByRole('button', { name: 'subdomain.confirmCancel' }),
    );
    expect(screen.queryByText('subdomain.confirmTitle')).toBeNull();
    expect(h.updateAsync).not.toHaveBeenCalled();
  });

  it('first-time set (no current subdomain, nothing released) saves without the dialog', async () => {
    h.settings.data = { subdomain: '' };
    render(<SubdomainSettings />);
    await userEvent.type(input(), 'brandnew');

    await userEvent.click(saveButton());
    expect(screen.queryByText('subdomain.confirmTitle')).toBeNull();
    expect(h.updateAsync).toHaveBeenCalledWith({ subdomain: 'brandnew' });
  });

  it('holds an invalid value back from saving (validation error shown, no dialog)', async () => {
    render(<SubdomainSettings />);
    await userEvent.clear(input());
    await userEvent.type(input(), 'ab'); // too short
    expect(screen.getByText('subdomain.errorTooShort')).toBeInTheDocument();

    expect(saveButton()).toBeDisabled();
    expect(h.updateAsync).not.toHaveBeenCalled();
  });
});
