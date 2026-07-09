import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';

const orders: { data: any[]; isLoading: boolean } = { data: [], isLoading: false };
let lastStatus: unknown = undefined;
const noop = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
const cancelMock = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };

vi.mock('../stockManagementApi', () => ({
  usePurchaseOrders: (status: unknown) => {
    lastStatus = status;
    return orders;
  },
  useCreatePurchaseOrder: () => noop,
  useSubmitPurchaseOrder: () => noop,
  useReceivePurchaseOrder: () => noop,
  useCancelPurchaseOrder: () => cancelMock,
  useSuppliers: () => ({ data: [] }),
  useStockItems: () => ({ data: [] }),
}));

vi.mock('../purchasingApi', () => ({
  useApprovePurchaseOrder: () => noop,
  useApplyLandedCost: () => noop,
}));

import PurchaseOrdersTab from './PurchaseOrdersTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  orders.data = [];
  orders.isLoading = false;
  lastStatus = undefined;
  cancelMock.mutate.mockClear();
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

  // deep-review FM8: cancel must confirm before firing the destructive mutation
  it('only cancels a purchase order after the user confirms', () => {
    orders.data = [
      { id: 'po1', orderNumber: 'PO-001', status: 'SUBMITTED', supplier: { name: 'Acme' }, items: [{ id: 'x' }], expectedDate: null },
    ];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PurchaseOrdersTab />);
    const row = screen.getByText('PO-001').closest('tr')!;
    const cancelBtn = within(row).getByTitle('Cancel');

    fireEvent.click(cancelBtn);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(cancelMock.mutate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(cancelBtn);
    expect(cancelMock.mutate).toHaveBeenCalledWith('po1');

    confirmSpy.mockRestore();
  });
});
