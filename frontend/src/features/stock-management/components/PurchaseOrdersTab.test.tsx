import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const orders: { data: any[]; isLoading: boolean } = { data: [], isLoading: false };
let lastStatus: unknown = undefined;
const noop = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../stockManagementApi', () => ({
  usePurchaseOrders: (status: unknown) => {
    lastStatus = status;
    return orders;
  },
  useCreatePurchaseOrder: () => noop,
  useSubmitPurchaseOrder: () => noop,
  useReceivePurchaseOrder: () => noop,
  useCancelPurchaseOrder: () => noop,
  useSuppliers: () => ({ data: [] }),
  useStockItems: () => ({ data: [] }),
}));

import PurchaseOrdersTab from './PurchaseOrdersTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  orders.data = [];
  orders.isLoading = false;
  lastStatus = undefined;
});

describe('PurchaseOrdersTab', () => {
  it('shows the loading state', () => {
    orders.isLoading = true;
    render(<PurchaseOrdersTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<PurchaseOrdersTab />);
    expect(screen.getByText('No purchase orders found')).toBeInTheDocument();
  });

  it('renders a purchase order row', () => {
    orders.data = [
      {
        id: 'po1',
        orderNumber: 'PO-001',
        status: 'DRAFT',
        supplier: { name: 'Acme' },
        items: [{ id: 'x' }],
        expectedDate: null,
      },
    ];
    render(<PurchaseOrdersTab />);
    const row = screen.getByText('PO-001').closest('tr')!;
    expect(within(row).getByText('Acme')).toBeInTheDocument();
  });

  it('passes the status filter down to the query (undefined when "all")', () => {
    render(<PurchaseOrdersTab />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'DRAFT' } });
    expect(lastStatus).toBe('DRAFT');
  });
});
