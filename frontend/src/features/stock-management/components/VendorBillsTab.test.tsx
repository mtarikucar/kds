import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';
import { useAuthStore } from '../../../store/authStore';
import type { VendorBill, VendorBillMatch } from '../purchasingApi';

// VendorBillsTab owns the AP list + create form + 3-way match panel. We mock
// the api hooks (mutable query/mutation stubs per test), register the `stock`
// namespace and pin an ADMIN user so the approve/mark-paid rail is visible.

const billsQuery: {
  data: VendorBill[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
const matchQuery: { data?: VendorBillMatch; isLoading: boolean; isError: boolean } =
  { data: undefined, isLoading: false, isError: false };
const createMutation = { mutate: vi.fn(), isPending: false };
const approveMutation = { mutate: vi.fn(), isPending: false };
const markPaidMutation = { mutate: vi.fn(), isPending: false };

vi.mock('../purchasingApi', () => ({
  useVendorBills: () => billsQuery,
  useCreateVendorBill: () => createMutation,
  useVendorBillMatch: () => matchQuery,
  useApproveVendorBill: () => approveMutation,
  useMarkVendorBillPaid: () => markPaidMutation,
}));

vi.mock('../stockManagementApi', () => ({
  useSuppliers: () => ({
    data: [{ id: 's1', name: 'ACME Foods', isActive: true }],
  }),
  usePurchaseOrders: () => ({
    data: [
      { id: 'po1', orderNumber: 'PO-001', supplierId: 's1', items: [] },
      { id: 'po2', orderNumber: 'PO-002', supplierId: 'other', items: [] },
    ],
  }),
}));

vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n.toFixed(2)}`,
}));

import VendorBillsTab from './VendorBillsTab';

function makeBill(over: Partial<VendorBill> = {}): VendorBill {
  return {
    id: 'b1',
    invoiceNumber: 'INV-2026-1',
    supplierId: 's1',
    purchaseOrderId: 'po1',
    invoiceDate: '2026-07-01T00:00:00.000Z',
    subtotal: '1000',
    taxAmount: '200',
    total: '1200',
    status: 'DISCREPANCY',
    matchVariance: '300',
    notes: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

beforeEach(() => {
  vi.clearAllMocks();
  billsQuery.data = [];
  billsQuery.isLoading = false;
  billsQuery.isError = false;
  matchQuery.data = undefined;
  useAuthStore.setState({
    user: { id: 'u1', role: 'ADMIN' } as never,
    isAuthenticated: true,
  });
});

describe('VendorBillsTab', () => {
  it('shows the empty state with a create CTA that opens the record form', () => {
    render(<VendorBillsTab />);
    expect(screen.getByText('No vendor bills yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Record a bill/ }));
    expect(screen.getByText('Record a vendor bill')).toBeTruthy();
  });

  it('blocks submit until required fields are valid, then posts the DTO payload', () => {
    render(<VendorBillsTab />);
    fireEvent.click(screen.getByRole('button', { name: /New bill/ }));

    // Empty submit → validation errors, no mutation.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(createMutation.mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Select a supplier')).toBeTruthy();
    expect(screen.getByText('Enter the invoice number')).toBeTruthy();
    expect(screen.getByText('Amount must be 0 or greater')).toBeTruthy();

    // Fill it in — the PO dropdown only offers the chosen supplier's POs.
    fireEvent.change(screen.getByLabelText('Supplier *'), {
      target: { value: 's1' },
    });
    const poSelect = screen.getByLabelText(
      'Linked PO (optional)'
    ) as HTMLSelectElement;
    expect([...poSelect.options].map((o) => o.textContent)).not.toContain(
      'PO-002'
    );
    fireEvent.change(poSelect, { target: { value: 'po1' } });
    fireEvent.change(screen.getByLabelText('Invoice No *'), {
      target: { value: 'INV-42' },
    });
    fireEvent.change(screen.getByLabelText('Invoice date *'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByLabelText('Goods net (excl. VAT) *'), {
      target: { value: '1000' },
    });
    fireEvent.change(screen.getByLabelText('Deductible VAT'), {
      target: { value: '200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(createMutation.mutate).toHaveBeenCalledTimes(1);
    expect(createMutation.mutate.mock.calls[0][0]).toEqual({
      supplierId: 's1',
      purchaseOrderId: 'po1',
      invoiceNumber: 'INV-42',
      invoiceDate: '2026-07-01',
      subtotal: 1000,
      taxAmount: 200,
      notes: undefined,
    });
  });

  it('renders the 3-way match panel with the discrepancy highlighted and wires the approve action', () => {
    billsQuery.data = [makeBill()];
    matchQuery.data = {
      linked: true,
      orderedTotal: 1000,
      receivedTotal: 900,
      invoiceTotal: 1200,
      variance: 300,
      tolerance: 9,
      matched: false,
      status: 'DISCREPANCY',
    };
    render(<VendorBillsTab />);

    // List row: invoice number, resolved supplier + PO names, status label.
    expect(screen.getByText('INV-2026-1')).toBeTruthy();
    expect(screen.getByText('ACME Foods')).toBeTruthy();
    expect(screen.getByText('PO-001')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /3-way match/ }));
    expect(screen.getByText(/Discrepancy — the invoice deviates/)).toBeTruthy();
    expect(screen.getByText('₺900.00')).toBeTruthy(); // received (GRN)
    const varianceRow = screen.getByTestId('match-variance-row');
    expect(varianceRow.className).toContain('bg-rose-50');

    // A DISCREPANCY bill is still approvable (manager override) — the button
    // must be there and call the mutation with the bill id.
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(approveMutation.mutate).toHaveBeenCalledTimes(1);
    expect(approveMutation.mutate.mock.calls[0][0]).toBe('b1');
  });
});
