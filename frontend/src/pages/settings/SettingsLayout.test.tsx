import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const sub = {
  hasFeature: vi.fn((_feature?: string) => false),
  hasIntegration: vi.fn((_domain?: string, _vendor?: string) => false),
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

  it('shows the delivery nav item for an integration-only (add-on) tenant even without the plan feature', () => {
    sub.hasFeature.mockReturnValue(false);
    sub.hasIntegration.mockImplementation((domain?: string) => domain === 'delivery');
    renderLayout();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/admin/settings/online-orders');
  });

  it('shows the delivery nav item for a plan-feature tenant even without the delivery add-on', () => {
    sub.hasFeature.mockImplementation((f?: string) => f === 'deliveryIntegration');
    sub.hasIntegration.mockReturnValue(false);
    renderLayout();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toContain('/admin/settings/online-orders');
  });

  it('hides the delivery nav item when neither the plan feature nor the add-on is present', () => {
    sub.hasFeature.mockReturnValue(false);
    sub.hasIntegration.mockReturnValue(false);
    renderLayout();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).not.toContain('/admin/settings/online-orders');
  });
});

/**
 * Tour-anchor regression guard (review F3). The sidebar renders TWICE — an
 * always-mounted mobile drawer (display:none on ≥lg via `lg:hidden` on its
 * container) and the desktop copy. react-joyride resolves its target with the
 * FIRST document.querySelector match and requires it to be visible; when the
 * hidden drawer copy carried data-tour="settings-nav" too, the admin tour's
 * settings step hit TARGET_NOT_FOUND forever.
 *
 * LIMITATION: jsdom performs no real layout, so "visible at desktop width" is
 * approximated structurally — a node counts as desktop-visible when neither
 * it nor any ancestor carries the Tailwind `lg:hidden` class (mobile-only
 * subtree). That is exactly the class split SettingsLayout uses, so the
 * approximation is faithful for this layout.
 */
function isDesktopVisible(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.classList?.contains('lg:hidden')) return false;
    node = node.parentElement;
  }
  return true;
}

describe('SettingsLayout tour anchor uniqueness', () => {
  it('exposes exactly ONE desktop-visible [data-tour="settings-nav"], and querySelector finds it first', () => {
    sub.hasFeature.mockReturnValue(true);
    sub.hasIntegration.mockReturnValue(true);
    const { container } = renderLayout();

    const anchors = Array.from(
      container.querySelectorAll('[data-tour="settings-nav"]'),
    );
    const visibleAnchors = anchors.filter(isDesktopVisible);
    expect(visibleAnchors).toHaveLength(1);

    // joyride uses the FIRST match — it must be the desktop-visible copy,
    // not a display:none drawer duplicate.
    const first = container.querySelector('[data-tour="settings-nav"]');
    expect(first).not.toBeNull();
    expect(isDesktopVisible(first as Element)).toBe(true);
  });
});
