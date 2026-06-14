import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const dash: { data: any; isLoading: boolean } = { data: null, isLoading: false };
vi.mock('../stockManagementApi', () => ({
  useStockDashboard: () => dash,
}));

import StockDashboard from './StockDashboard';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  dash.data = null;
  dash.isLoading = false;
});

function fullDashboard(over: Partial<any> = {}) {
  return {
    totalItems: 12,
    activeItems: 10,
    lowStockCount: 2,
    expiringBatchCount: 1,
    pendingPurchaseOrders: 3,
    wasteLast30Days: { count: 4 },
    lowStockItems: [],
    recentMovements: [],
    expiringBatches: [],
    ...over,
  };
}

describe('StockDashboard', () => {
  it('shows the loading state while the query is pending', () => {
    dash.isLoading = true;
    render(<StockDashboard />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders nothing when there is no dashboard data', () => {
    const { container } = render(<StockDashboard />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the stat values from the dashboard payload', () => {
    dash.data = fullDashboard();
    render(<StockDashboard />);
    expect(screen.getByText('Total Items')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders a low-stock row when items are below threshold', () => {
    dash.data = fullDashboard({
      lowStockItems: [
        { id: 'l1', name: 'Onion', currentStock: 1, minStock: 5, unit: 'kg' },
      ],
    });
    render(<StockDashboard />);
    expect(screen.getByText('Onion')).toBeInTheDocument();
    expect(screen.getByText(/1\.0 \/ 5\.0 kg/)).toBeInTheDocument();
  });

  it('signs recent-movement quantities (+ for inflow)', () => {
    dash.data = fullDashboard({
      recentMovements: [
        {
          id: 'm1',
          quantity: 3,
          notes: 'restock',
          stockItem: { name: 'Flour' },
        },
      ],
    });
    render(<StockDashboard />);
    expect(screen.getByText('+3.0')).toBeInTheDocument();
  });
});
