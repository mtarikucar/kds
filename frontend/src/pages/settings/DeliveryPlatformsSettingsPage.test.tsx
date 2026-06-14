import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const state: { data: any; isLoading: boolean; isError: boolean } = {
  data: [],
  isLoading: false,
  isError: false,
};
vi.mock('../../features/delivery-platforms/deliveryPlatformsApi', () => ({
  useDeliveryPlatformConfigs: () => state,
}));
// Children are exercised by their own suites; here we just need to know which
// platform each card got so the config-mapping logic is verifiable.
vi.mock('../../components/delivery-platforms/PlatformCard', () => ({
  default: ({ platform, config }: { platform: string; config: unknown }) => (
    <div data-testid="platform-card" data-platform={platform} data-has-config={String(!!config)} />
  ),
}));
vi.mock('../../components/delivery-platforms/PlatformLogViewer', () => ({
  default: () => <div data-testid="log-viewer" />,
}));

import DeliveryPlatformsSettingsPage from './DeliveryPlatformsSettingsPage';

beforeEach(() => {
  state.data = [];
  state.isLoading = false;
  state.isError = false;
});

describe('DeliveryPlatformsSettingsPage', () => {
  it('shows the skeleton while loading', () => {
    state.isLoading = true;
    const { container } = render(<DeliveryPlatformsSettingsPage />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('shows the error message on failure', () => {
    state.isError = true;
    render(<DeliveryPlatformsSettingsPage />);
    expect(screen.getByText('onlineOrders.loadError')).toBeInTheDocument();
  });

  it('renders a card for each known platform', () => {
    render(<DeliveryPlatformsSettingsPage />);
    const cards = screen.getAllByTestId('platform-card');
    const platforms = cards.map((c) => c.getAttribute('data-platform'));
    expect(platforms).toEqual(['GETIR', 'YEMEKSEPETI', 'TRENDYOL', 'MIGROS']);
  });

  it('maps the fetched config onto the matching platform card', () => {
    state.data = [{ platform: 'GETIR', isEnabled: true }];
    render(<DeliveryPlatformsSettingsPage />);
    const getir = screen
      .getAllByTestId('platform-card')
      .find((c) => c.getAttribute('data-platform') === 'GETIR')!;
    expect(getir.getAttribute('data-has-config')).toBe('true');
    const migros = screen
      .getAllByTestId('platform-card')
      .find((c) => c.getAttribute('data-platform') === 'MIGROS')!;
    expect(migros.getAttribute('data-has-config')).toBe('false');
  });

  it('renders the activity log viewer', () => {
    render(<DeliveryPlatformsSettingsPage />);
    expect(screen.getByTestId('log-viewer')).toBeInTheDocument();
  });
});
