import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MenuDrawer from './MenuDrawer';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * fake-working-sweep-3 M11 regression. The persisted
 * QrMenuSettings.showRestaurantInfo toggle was plumbed into the customer
 * layout but the live MenuDrawer rendered the WiFi block (SSID + copyable
 * password) and the social-media links UNCONDITIONALLY. The drawer now
 * gates both on the prop, defaulting to `true` for legacy callers.
 */

const tenant = {
  id: 't1',
  name: 'Acme Diner',
  wifi: { ssid: 'AcmeGuest', password: 'hunter2' },
  socialMedia: { instagram: 'acme', facebook: 'acme' },
};

const settings = { primaryColor: '#FF6B6B', secondaryColor: '#6366f1' };

function renderDrawer(showRestaurantInfo?: boolean) {
  render(
    <MemoryRouter>
      <MenuDrawer
        isOpen
        onClose={() => {}}
        tenant={tenant}
        settings={settings}
        sessionId="sess-1"
        showRestaurantInfo={showRestaurantInfo}
      />
    </MemoryRouter>,
  );
}

describe('MenuDrawer showRestaurantInfo gating', () => {
  it('shows WiFi SSID/password and social links when showRestaurantInfo is true', () => {
    renderDrawer(true);
    expect(screen.getByText('AcmeGuest')).toBeInTheDocument();
    expect(screen.getByText('hunter2')).toBeInTheDocument();
    expect(screen.getByText('Follow Us')).toBeInTheDocument();
  });

  it('hides WiFi and social blocks when showRestaurantInfo is false', () => {
    renderDrawer(false);
    expect(screen.queryByText('AcmeGuest')).not.toBeInTheDocument();
    expect(screen.queryByText('hunter2')).not.toBeInTheDocument();
    expect(screen.queryByText('Follow Us')).not.toBeInTheDocument();
  });

  it('defaults to showing the blocks when the prop is omitted (legacy callers)', () => {
    renderDrawer(undefined);
    expect(screen.getByText('AcmeGuest')).toBeInTheDocument();
    expect(screen.getByText('Follow Us')).toBeInTheDocument();
  });
});
