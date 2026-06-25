import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Stub the three heavy child pages so the hub can be tested in isolation —
// each renders an identifiable marker we assert on.
vi.mock('../marketplace/MarketplacePage', () => ({
  default: () => <div>ADDONS_PAGE</div>,
}));
vi.mock('../hardware-store/StorePage', () => ({
  default: () => <div>HARDWARE_PAGE</div>,
}));
vi.mock('../hardware-store/HardwareOrdersListPage', () => ({
  default: () => <div>ORDERS_PAGE</div>,
}));

import StoreHubPage from './StoreHubPage';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/store" element={<StoreHubPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StoreHubPage tab selection', () => {
  it('defaults to the add-ons tab with no params', () => {
    renderAt('/admin/store');
    expect(screen.getByText('ADDONS_PAGE')).toBeInTheDocument();
    expect(screen.queryByText('HARDWARE_PAGE')).not.toBeInTheDocument();
  });

  it('honours an explicit ?tab=orders', () => {
    renderAt('/admin/store?tab=orders');
    expect(screen.getByText('ORDERS_PAGE')).toBeInTheDocument();
  });

  it('honours an explicit ?tab=hardware', () => {
    renderAt('/admin/store?tab=hardware');
    expect(screen.getByText('HARDWARE_PAGE')).toBeInTheDocument();
  });

  // The BLOCKER regression: the public landing "Sipariş ver" CTA deep-links to
  // /admin/store?sku=<sku>. That SKU bridge lives in StorePage (hardware tab),
  // so a bare ?sku= MUST open on hardware — not the default add-ons tab — or
  // the buy link silently no-ops.
  it('opens the hardware tab for a ?sku= deeplink with no explicit tab', () => {
    renderAt('/admin/store?sku=KDS-21');
    expect(screen.getByText('HARDWARE_PAGE')).toBeInTheDocument();
    expect(screen.queryByText('ADDONS_PAGE')).not.toBeInTheDocument();
  });

  it('an explicit ?tab= still wins over ?sku=', () => {
    renderAt('/admin/store?tab=addons&sku=KDS-21');
    expect(screen.getByText('ADDONS_PAGE')).toBeInTheDocument();
  });
});
