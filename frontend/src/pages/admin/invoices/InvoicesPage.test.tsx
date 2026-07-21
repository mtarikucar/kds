import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// NOTE: this file's import graph pulls in `lib/api-error` -> `i18n/config`,
// which registers the full locale bundle — so t() resolves to real English
// strings here (unlike suites whose graph stays outside i18n/config).

const h = vi.hoisted(() => ({
  invoicesResult: {
    data: undefined as any,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  settingsResult: { data: undefined as any },
  invoiceResult: { data: undefined as any, isLoading: false, isError: false },
  ordersResult: { data: undefined as any, isLoading: false, isError: false },
  syncAsync: vi.fn(),
  cancelAsync: vi.fn(),
  createAsync: vi.fn(),
  creditNoteAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('../../../features/accounting/accountingApi', () => ({
  useGetSalesInvoices: () => h.invoicesResult,
  useGetAccountingSettings: () => h.settingsResult,
  useInvoice: (id: string | null) => (id ? h.invoiceResult : { data: undefined }),
  useCreateInvoiceFromOrder: () => ({
    mutateAsync: h.createAsync,
    isPending: false,
  }),
  useSyncInvoice: () => ({ mutateAsync: h.syncAsync }),
  useCancelInvoice: () => ({ mutateAsync: h.cancelAsync }),
}));
vi.mock('../../../features/accounting/eBelgeApi', () => ({
  useIssueCreditNote: () => ({
    mutateAsync: h.creditNoteAsync,
    isPending: false,
  }),
}));
vi.mock('../../../features/orders/ordersApi', () => ({
  useOrders: () => h.ordersResult,
}));
// useFormatCurrencyExtended -> useCurrency -> react-query; stub the currency
// hook so the panel renders without a QueryClientProvider.
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => 'TRY',
}));
vi.mock('sonner', () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
    info: (m: string) => h.toastInfo(m),
  },
}));

import { InvoicesPanel } from './InvoicesPage';

const invoice = {
  id: 'inv-1',
  invoiceNumber: 'FTR-000001',
  type: 'SALES',
  status: 'ISSUED',
  customerName: 'Acme',
  subtotal: 90,
  taxAmount: 10,
  totalAmount: 100,
  discount: 0,
  currency: 'TRY',
  issueDate: '2026-07-01T10:00:00Z',
  items: [],
};

const paidOrder = {
  id: 'order-1',
  orderNumber: '1042',
  customerName: 'Ali',
  finalAmount: 250,
  createdAt: '2026-07-01T09:00:00Z',
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <InvoicesPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.invoicesResult.data = {
    data: [invoice],
    meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
  };
  h.invoicesResult.isLoading = false;
  h.invoicesResult.isError = false;
  h.settingsResult.data = { provider: 'PARASUT' };
  h.invoiceResult.data = { ...invoice, items: [] };
  h.invoiceResult.isLoading = false;
  h.invoiceResult.isError = false;
  h.ordersResult.data = [paidOrder];
  h.ordersResult.isLoading = false;
  h.ordersResult.isError = false;
  h.syncAsync.mockReset();
  h.createAsync.mockReset();
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.toastInfo.mockReset();
});

describe('InvoicesPanel — create invoice from order (D1)', () => {
  it('opens the modal, selects a paid order and creates the invoice', async () => {
    h.createAsync.mockResolvedValue({ id: 'inv-new' });
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: 'Create Invoice' }));
    const modal = within(screen.getByRole('dialog'));
    // Paid order is listed inside the modal.
    expect(modal.getByText(/#1042/)).toBeInTheDocument();

    await userEvent.click(modal.getByRole('radio'));
    await userEvent.click(modal.getByRole('button', { name: 'Create Invoice' }));

    await waitFor(() =>
      expect(h.createAsync).toHaveBeenCalledWith({ orderId: 'order-1' }),
    );
    expect(h.toastSuccess).toHaveBeenCalledWith('Invoice created');
    // Modal closes after creation.
    await waitFor(() =>
      expect(screen.queryByText('Create Invoice from Order')).not.toBeInTheDocument(),
    );
  });

  it('blocks submission while the VKN/TCKN is incomplete', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Create Invoice' }));
    const modal = within(screen.getByRole('dialog'));
    await userEvent.click(modal.getByRole('radio'));

    const taxInput = modal
      .getAllByRole('textbox')
      .find((el) => el.getAttribute('inputmode') === 'numeric')!;
    await userEvent.type(taxInput, '12345');
    expect(
      modal.getByText('Tax ID must be 10 (VKN) or 11 (TCKN) digits'),
    ).toBeInTheDocument();

    await userEvent.click(modal.getByRole('button', { name: 'Create Invoice' }));
    expect(h.createAsync).not.toHaveBeenCalled();
  });
});

describe('InvoicesPanel — detail drawer (D3)', () => {
  it('opens the drawer with the invoice details when a row is clicked', async () => {
    h.invoiceResult.data = {
      ...invoice,
      items: [
        {
          id: 'item-1',
          description: 'Adana Kebap',
          quantity: 2,
          unitPrice: 40,
          taxRate: 10,
          taxAmount: 8,
          subtotal: 80,
          total: 88,
        },
      ],
      taxBreakdown: { 10: { taxableAmount: 80, taxAmount: 8 } },
    };
    renderPanel();

    await userEvent.click(screen.getByText('FTR-000001'));
    expect(screen.getByText(/Invoice Details — FTR-000001/)).toBeInTheDocument();
    expect(screen.getByText('Adana Kebap')).toBeInTheDocument();
  });
});

describe('InvoicesPanel — sync toast honesty (A6-FE)', () => {
  it('does NOT toast success when the sync was a no-op', async () => {
    // Endpoint re-reads the invoice; a NONE provider leaves it untouched.
    h.syncAsync.mockResolvedValue({ ...invoice, syncedAt: null, syncError: null });
    renderPanel();

    await userEvent.click(screen.getByTitle('Sync'));

    await waitFor(() =>
      expect(h.toastInfo).toHaveBeenCalledWith(
        expect.stringContaining('Nothing was synced'),
      ),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it('toasts success only when the invoice actually reached the provider', async () => {
    h.syncAsync.mockResolvedValue({
      ...invoice,
      syncedAt: '2026-07-01T11:00:00Z',
    });
    renderPanel();

    await userEvent.click(screen.getByTitle('Sync'));

    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith('Invoice sent to the provider'),
    );
  });
});

describe('InvoicesPanel — empty state CTA', () => {
  it('points at the accounting settings when the list is empty and no provider is set', () => {
    h.invoicesResult.data = {
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
    };
    h.settingsResult.data = { provider: 'NONE' };
    renderPanel();

    expect(
      screen.getByText(/No e-document provider connection is set up yet/),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Go to Settings/ });
    expect(link).toHaveAttribute('href', '/admin/settings/accounting');
  });
});
