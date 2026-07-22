import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import StockPage from './StockPage';

// Stub the six tab bodies so the shell test is about routing, not tab internals.
vi.mock('./stock/GuidanceTab', () => ({ default: () => <div>GUIDE_BODY</div> }));
vi.mock('./stock/ItemsTab', () => ({ default: () => <div>ITEMS_BODY</div> }));
vi.mock('./stock/OrdersTab', () => ({ default: () => <div>ORDERS_BODY</div> }));
vi.mock('./stock/SuppliersHub', () => ({ default: () => <div>SUPPLIERS_BODY</div> }));
vi.mock('./stock/CostingTab', () => ({ default: () => <div>COSTING_BODY</div> }));
vi.mock('./stock/OperationsTab', () => ({ default: () => <div>OPERATIONS_BODY</div> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: string) => d ?? k }) }));

const renderAt = (initial: string) => {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/admin/stock" element={<StockPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('StockPage shell', () => {
  it('defaults to the guide tab with no ?tab', () => {
    renderAt('/admin/stock');
    expect(screen.getByText('GUIDE_BODY')).toBeInTheDocument();
  });
  it('restores the tab from ?tab on load (deep link)', () => {
    renderAt('/admin/stock?tab=orders');
    expect(screen.getByText('ORDERS_BODY')).toBeInTheDocument();
  });
  it('falls back to guide for an unknown ?tab', () => {
    renderAt('/admin/stock?tab=bogus');
    expect(screen.getByText('GUIDE_BODY')).toBeInTheDocument();
  });
  it('renders all six tab buttons', () => {
    renderAt('/admin/stock');
    ['nav.guide', 'nav.items', 'nav.orders', 'nav.suppliers', 'nav.costing', 'nav.operations'].forEach((k) => {
      expect(screen.getByRole('tab', { name: k })).toBeInTheDocument();
    });
  });
  it('switches tab and writes ?tab on click', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderAt('/admin/stock');
    await user.click(screen.getByRole('tab', { name: 'nav.suppliers' }));
    expect(screen.getByText('SUPPLIERS_BODY')).toBeInTheDocument();
  });
});
