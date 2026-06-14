import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const sub = {
  hasFeature: vi.fn(() => false),
  hasIntegration: vi.fn(() => false),
};
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => sub,
}));

import SettingsLayout from './SettingsLayout';

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/admin/settings/pos']}>
      <SettingsLayout />
    </MemoryRouter>,
  );
}

describe('SettingsLayout nav gating', () => {
  it('always shows the ungated POS / QR / Reports items', () => {
    sub.hasFeature.mockReturnValue(false);
    sub.hasIntegration.mockReturnValue(false);
    renderLayout();
    // ungated items render regardless of plan
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/admin/settings/pos');
    expect(links).toContain('/admin/settings/qr-menu');
    expect(links).toContain('/admin/settings/reports');
  });

  it('hides feature-gated items when the feature is absent', () => {
    sub.hasFeature.mockReturnValue(false);
    sub.hasIntegration.mockReturnValue(false);
    renderLayout();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    // branding (customBranding), integrations/webhooks (apiAccess) are hidden
    expect(links).not.toContain('/admin/settings/branding');
    expect(links).not.toContain('/admin/settings/integrations');
    expect(links).not.toContain('/admin/settings/webhooks');
  });

  it('reveals feature-gated items when the plan grants the feature', () => {
    sub.hasFeature.mockReturnValue(true);
    sub.hasIntegration.mockReturnValue(true);
    renderLayout();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/admin/settings/branding');
    expect(links).toContain('/admin/settings/integrations');
    expect(links).toContain('/admin/settings/online-orders');
    expect(links).toContain('/admin/settings/sms');
  });
});
