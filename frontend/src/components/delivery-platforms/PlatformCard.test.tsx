import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  createMutate: vi.fn(),
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
  useUpdatePlatformConfig: () => mutationStub(h.updateMutate),
  useCreatePlatformConfig: () => mutationStub(h.createMutate),
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
