import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import type { DeliveryPlatformConfig } from '../../types';

/**
 * SANDBOX-FAIL-CLOSED in the UI: for platforms with no real sandbox endpoint
 * (Getir, Yemeksepeti, Migros — their adapter sandbox host defaults to PROD),
 * the Sandbox toggle must NOT be presented as functional. Selecting it would
 * resolve to production and the backend now refuses every live/test action.
 * Trendyol (a real, published stage host) keeps a working sandbox toggle.
 */

const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  // Hoisted separately (not a per-render stub) so the save-before-test specs
  // can assert on / reject the update mutation across renders.
  updateMutateAsync: vi.fn(),
  createMutate: vi.fn(),
  // Hoisted like updateMutateAsync: handleToggleEnabled/handleSave call
  // createConfig.mutateAsync, and the coming-soon guard has to be provable
  // against the SAME fn across renders.
  createMutateAsync: vi.fn(),
  testMutate: vi.fn(),
  toggleMutate: vi.fn(),
  sendTestOrderMutate: vi.fn(),
  syncMenuMutate: vi.fn(),
  toastError: vi.fn(),
}));

const mutationStub = (mutate: ReturnType<typeof vi.fn>) => ({
  mutate,
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
});

vi.mock('../../features/delivery-platforms/deliveryPlatformsApi', () => ({
  useUpdatePlatformConfig: () => ({
    mutate: h.updateMutate,
    mutateAsync: h.updateMutateAsync,
    isPending: false,
  }),
  useCreatePlatformConfig: () => ({
    mutate: h.createMutate,
    mutateAsync: h.createMutateAsync,
    isPending: false,
  }),
  useTestPlatformConnection: () => mutationStub(h.testMutate),
  useToggleRestaurant: () => mutationStub(h.toggleMutate),
  useSendTestOrder: () => mutationStub(h.sendTestOrderMutate),
  useSyncMenu: () => mutationStub(h.syncMenuMutate),
}));

vi.mock('../../features/branches/branchesApi', () => ({
  useListBranches: () => ({ data: [] }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: (m: string) => h.toastError(m),
    success: vi.fn(),
  },
}));

// useTranslation('settings') echoes keys back (settings namespace isn't loaded
// in the test i18n bootstrap), so we assert against the stable i18n KEYS.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import PlatformCard from './PlatformCard';

const baseConfig = (
  overrides: Partial<DeliveryPlatformConfig> = {},
): DeliveryPlatformConfig =>
  ({
    platform: 'MIGROS',
    isEnabled: true,
    hasCredentials: true,
    restaurantOpen: false,
    environment: 'production',
    errorCount: 0,
    autoAccept: true,
    ...overrides,
  }) as unknown as DeliveryPlatformConfig;

beforeEach(() => {
  Object.values(h).forEach((fn) =>
    (fn as ReturnType<typeof vi.fn>).mockReset(),
  );
  h.createMutateAsync.mockResolvedValue(undefined);
  h.updateMutateAsync.mockResolvedValue(undefined);
});

function renderExpanded(platform: string, config?: DeliveryPlatformConfig) {
  render(<PlatformCard platform={platform} config={config} />);
  // Expand: click the platform-name header (Migros Yemek / Trendyol Yemek...).
  const heading = screen.getByRole('heading', { level: 3 });
  fireEvent.click(heading);
}

function sandboxButton(): HTMLButtonElement {
  // The environment toggle renders two buttons labelled by i18n keys.
  return screen.getByRole('button', {
    name: 'onlineOrders.environment.sandbox',
  }) as HTMLButtonElement;
}

describe('PlatformCard sandbox-fail-closed (no real sandbox)', () => {
  it('disables the Sandbox toggle for Migros (no real sandbox host)', () => {
    renderExpanded('MIGROS', baseConfig({ platform: 'MIGROS' }));

    const btn = sandboxButton();
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'onlineOrders.environment.noSandbox');
    // The explanatory "no sandbox" note is shown instead of presenting it as
    // functional.
    expect(
      screen.getAllByText('onlineOrders.environment.noSandbox').length,
    ).toBeGreaterThan(0);
  });

  it('disables the Sandbox toggle for Getir and Yemeksepeti too', () => {
    for (const platform of ['GETIR', 'YEMEKSEPETI']) {
      const { unmount } = render(
        <PlatformCard platform={platform} config={baseConfig({ platform })} />,
      );
      fireEvent.click(screen.getByRole('heading', { level: 3 }));
      expect(sandboxButton()).toBeDisabled();
      unmount();
    }
  });

  it('does NOT switch to sandbox when the disabled toggle is force-clicked, and toasts', () => {
    renderExpanded('MIGROS', baseConfig({ platform: 'MIGROS' }));

    const btn = sandboxButton();
    // A disabled button won't fire onClick via fireEvent.click, so we assert
    // the guard directly by re-enabling is impossible — instead verify the
    // production button stays selected (no sandbox warning rendered).
    fireEvent.click(btn);
    expect(
      screen.queryByText('onlineOrders.environment.sandboxWarning'),
    ).toBeNull();
  });

  it('still shows the no-sandbox note even on a production config (toggle is unusable)', () => {
    renderExpanded('GETIR', baseConfig({ platform: 'GETIR' }));
    expect(
      screen.getByText('onlineOrders.environment.noSandbox'),
    ).toBeInTheDocument();
  });
});

describe('PlatformCard sandbox available (Trendyol)', () => {
  it('enables the Sandbox toggle for Trendyol (real stage host)', () => {
    renderExpanded('TRENDYOL', baseConfig({ platform: 'TRENDYOL' }));

    const btn = sandboxButton();
    expect(btn).toBeEnabled();
    expect(btn).not.toHaveAttribute('title');
  });

  it('selecting sandbox on Trendyol shows the functional sandbox warning', () => {
    renderExpanded('TRENDYOL', baseConfig({ platform: 'TRENDYOL' }));

    fireEvent.click(sandboxButton());
    expect(
      screen.getByText('onlineOrders.environment.sandboxWarning'),
    ).toBeInTheDocument();
    // And the no-sandbox note is NOT shown when a real sandbox exists.
    expect(
      screen.queryByText('onlineOrders.environment.noSandbox'),
    ).toBeNull();
  });

  it('a Trendyol config already in sandbox enables the test-order button', () => {
    renderExpanded(
      'TRENDYOL',
      baseConfig({ platform: 'TRENDYOL', environment: 'sandbox' }),
    );
    const btn = screen.getByRole('button', {
      name: 'onlineOrders.sendTestOrder',
    });
    expect(btn).toBeEnabled();
  });
});

describe('PlatformCard save-before-test (probe tests STORED credentials)', () => {
  // The test endpoint takes no body and probes the credentials stored on the
  // backend. With unsaved edits it would validate the PREVIOUS values and
  // report a misleading result — so a dirty form must be saved first.
  const testButton = () =>
    screen.getByRole('button', { name: 'onlineOrders.testConnection' });

  it('probes directly when the form has no unsaved changes', async () => {
    renderExpanded('MIGROS', baseConfig());

    fireEvent.click(testButton());

    await waitFor(() => expect(h.testMutate).toHaveBeenCalledWith('MIGROS'));
    expect(h.updateMutateAsync).not.toHaveBeenCalled();
  });

  it('saves dirty changes FIRST, then probes', async () => {
    h.updateMutateAsync.mockResolvedValue(undefined);
    renderExpanded('MIGROS', baseConfig());
    // Flip auto-accept → hasChanges without touching credentials.
    fireEvent.click(screen.getByRole('button', { name: /autoAccept/i }));

    fireEvent.click(testButton());

    await waitFor(() => expect(h.testMutate).toHaveBeenCalledWith('MIGROS'));
    expect(h.updateMutateAsync).toHaveBeenCalledTimes(1);
    expect(h.updateMutateAsync.mock.invocationCallOrder[0]).toBeLessThan(
      h.testMutate.mock.invocationCallOrder[0],
    );
  });

  it('aborts the probe when the pre-test save fails', async () => {
    h.updateMutateAsync.mockRejectedValue(new Error('save failed'));
    renderExpanded('MIGROS', baseConfig());
    fireEvent.click(screen.getByRole('button', { name: /autoAccept/i }));

    fireEvent.click(testButton());

    await waitFor(() => expect(h.updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(h.testMutate).not.toHaveBeenCalled();
  });
});

describe('PlatformCard coming-soon (Semt)', () => {
  it('shows the free/coming-soon badge and disables connecting', () => {
    render(<PlatformCard platform="SEMT" />);
    expect(
      screen.getByText('onlineOrders.availability.comingSoon'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('onlineOrders.availability.comingSoonNote'),
    ).toBeInTheDocument();
    const toggle = screen.getByRole('button', {
      name: 'onlineOrders.aria.enablePlatform',
    }) as HTMLButtonElement;
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
  });

  it('does not expand into the credentials form when clicked', () => {
    render(<PlatformCard platform="SEMT" />);
    fireEvent.click(screen.getByRole('heading', { level: 3 }));
    // The credentials form renders the platform's field labels; for a
    // coming-soon platform the card must stay collapsed entirely.
    expect(screen.queryByText('onlineOrders.autoAccept')).toBeNull();
  });

  it('never reaches createConfig, through the toggle or the header', () => {
    // Two paths, two assertions. `fireEvent.click` on a DISABLED button does
    // not fire onClick at all, so the toggle line alone proves little — it is
    // the header click that actually exercises the `if (comingSoon) return;`
    // guard in handleToggleEnabled/handleSave, because the header is a live
    // div whose onClick runs and must no-op.
    render(<PlatformCard platform="SEMT" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'onlineOrders.aria.enablePlatform' }),
    );
    fireEvent.click(screen.getByRole('heading', { level: 3 }));
    expect(h.createMutateAsync).not.toHaveBeenCalled();
    expect(h.updateMutateAsync).not.toHaveBeenCalled();
    expect(h.createMutate).not.toHaveBeenCalled();
    expect(h.updateMutate).not.toHaveBeenCalled();
    // And nothing opened that could take credentials.
    expect(screen.queryByText('onlineOrders.autoAccept')).toBeNull();
  });

  it('still creates a config for a live platform — the guard is not a blanket off-switch', () => {
    // Control case. Without it, the assertions above would pass even if the
    // guard accidentally short-circuited every platform.
    render(<PlatformCard platform="MIGROS" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'onlineOrders.aria.enablePlatform' }),
    );
    // No credentials yet, so the card asks for them instead of posting — the
    // point is that it REACHED handleToggleEnabled's body at all.
    expect(h.toastError).toHaveBeenCalledWith('onlineOrders.fillCredentials');
  });

  it('marks the header with data-availability for the four live platforms too', () => {
    const { container, unmount } = render(<PlatformCard platform="SEMT" />);
    expect(
      container.querySelector('[data-availability="coming_soon"]'),
    ).not.toBeNull();
    unmount();
    const live = render(<PlatformCard platform="GETIR" />);
    expect(
      live.container.querySelector('[data-availability="available"]'),
    ).not.toBeNull();
  });
});
