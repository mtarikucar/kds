import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const counts: { data: any[]; isLoading: boolean } = { data: [], isLoading: false };
let lastStatus: unknown = undefined;
const noop = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../stockManagementApi', () => ({
  useStockCounts: (status: unknown) => {
    lastStatus = status;
    return counts;
  },
  useStockCount: () => ({ data: null, isLoading: false }),
  useCreateStockCount: () => noop,
  useUpdateStockCountItem: () => noop,
  useFinalizeStockCount: () => noop,
  useCancelStockCount: () => noop,
}));

import StockCountsTab from './StockCountsTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  counts.data = [];
  counts.isLoading = false;
  lastStatus = undefined;
});

describe('StockCountsTab', () => {
  it('shows the loading state', () => {
    counts.isLoading = true;
    render(<StockCountsTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<StockCountsTab />);
    expect(screen.getByText('No stock counts found')).toBeInTheDocument();
  });

  it('renders a stock count row', () => {
    counts.data = [
      {
        id: 'c1',
        name: 'June count',
        status: 'IN_PROGRESS',
        items: [{ id: 'x' }],
        createdAt: new Date().toISOString(),
      },
    ];
    render(<StockCountsTab />);
    const row = screen.getByText('June count').closest('tr')!;
    expect(within(row).getByText('June count')).toBeInTheDocument();
  });

  it('passes the status filter down to the query', () => {
    render(<StockCountsTab />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'COMPLETED' } });
    expect(lastStatus).toBe('COMPLETED');
  });
});
