import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18next from 'i18next';
import enHardware from '../../i18n/locales/en/hardware.json';
import type { HardwareOrderDetail } from './storeApi';

// HardwareOrderDetailPage renders one hardware order: loading / not-found /
// detail. On the happy path it prints item rows, the totals block (skipping
// zero tax/shipping), the status pill, the installation note, shipments, and
// the shipping address rendered through the extracted formatAddress helper.
// We mock the query hook + useParams and register the `hardware` namespace.

const orderState: { data?: HardwareOrderDetail; isLoading: boolean; error: unknown } = {
  data: undefined,
  isLoading: false,
  error: null,
};

vi.mock('./storeApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./storeApi')>();
  return {
    ...actual,
    useGetHardwareOrder: () => orderState,
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useParams: () => ({ id: 'order-123' }) };
});

import HardwareOrderDetailPage from './HardwareOrderDetailPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'hardware', enHardware, true, true);
});

function makeOrder(over: Partial<HardwareOrderDetail> = {}): HardwareOrderDetail {
  return {
    id: 'order-123456',
    status: 'paid',
    subtotalCents: 100000,
    taxCents: 18000,
    shippingCents: 0,
    totalCents: 118000,
    currency: 'TRY',
    installation: null,
    paymentRef: null,
    createdAt: '2026-06-14T10:00:00Z',
    updatedAt: '2026-06-14T10:00:00Z',
    itemCount: 1,
    branchId: null,
    shippingAddress: null,
    billingAddress: null,
    notes: null,
    items: [
      {
        id: 'li-1',
        productId: 'p-1',
        sku: 'KDS-15',
        name: 'KDS Screen 15"',
        qty: 2,
        unitCents: 50000,
        serials: [],
        acquisition: 'sell',
      },
    ],
    shipments: [],
    installations: [],
    ...over,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <HardwareOrderDetailPage />
    </MemoryRouter>,
  );
}

describe('HardwareOrderDetailPage', () => {
  beforeEach(() => {
    orderState.data = undefined;
    orderState.isLoading = false;
    orderState.error = null;
  });

  it('shows the loading copy while the order query is pending', () => {
    orderState.isLoading = true;
    renderPage();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the not-found banner + back link on error', () => {
    orderState.error = new Error('403');
    renderPage();
    expect(screen.getByText("Order not found or you don't have access.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to order list/ })).toBeInTheDocument();
  });

  it('shows the not-found banner when the order is missing (no error, no data)', () => {
    orderState.data = undefined;
    orderState.error = null;
    renderPage();
    expect(screen.getByText("Order not found or you don't have access.")).toBeInTheDocument();
  });

  it('renders the order number (first 8 chars of id) and the status pill', () => {
    orderState.data = makeOrder({ id: 'abcd1234efgh', status: 'shipped' });
    renderPage();
    // orderNo: "Order #{{id}}" with id sliced to 8.
    expect(screen.getByRole('heading', { name: 'Order #abcd1234' })).toBeInTheDocument();
    // orderStatus.shipped -> "In transit"
    expect(screen.getByText('In transit')).toBeInTheDocument();
  });

  it('renders an item row with its line total (unit * qty)', () => {
    orderState.data = makeOrder();
    renderPage();
    const row = screen.getByText('KDS Screen 15"').closest('tr')!;
    expect(within(row).getByText('2')).toBeInTheDocument(); // qty
    // 50000 cents * 2 = 100000 cents = ₺1.000,00 (tr-TR)
    expect(within(row).getByText(/1\.000,00/)).toBeInTheDocument();
  });

  it('shows VAT in the totals block but omits a zero shipping line', () => {
    orderState.data = makeOrder({ taxCents: 18000, shippingCents: 0 });
    renderPage();
    expect(screen.getByText('VAT')).toBeInTheDocument();
    // Shipping line is conditionally rendered only when > 0.
    expect(screen.queryByText('Shipping')).not.toBeInTheDocument();
    expect(screen.getByText('Grand total')).toBeInTheDocument();
  });

  it('renders the shipping address via formatAddress (structured -> stacked lines)', () => {
    orderState.data = makeOrder({
      shippingAddress: {
        recipientName: 'Mehmet Mağaza',
        phone: '+905551234567',
        line1: 'Atatürk Cad. 12',
        district: 'Kadıköy',
        city: 'İstanbul',
        postalCode: '34710',
        country: 'Türkiye',
      },
    });
    renderPage();

    const addrBox = screen.getByText('Shipping address').closest('div')!;
    expect(within(addrBox).getByText('Mehmet Mağaza')).toBeInTheDocument();
    expect(within(addrBox).getByText('Atatürk Cad. 12')).toBeInTheDocument();
    // district + city joined on one line by formatAddress.
    expect(within(addrBox).getByText('Kadıköy, İstanbul')).toBeInTheDocument();
  });

  it('does not render an address box when the order has no shipping address', () => {
    orderState.data = makeOrder({ shippingAddress: null });
    renderPage();
    expect(screen.queryByText('Shipping address')).not.toBeInTheDocument();
  });

  it('renders the installation note for a requested installation', () => {
    orderState.data = makeOrder({ installation: 'requested' });
    renderPage();
    expect(
      screen.getByText(/Installation request received\./),
    ).toBeInTheDocument();
  });

  it('renders shipment rows with carrier + tracking number', () => {
    orderState.data = makeOrder({
      shipments: [
        {
          id: 'sh-1',
          carrier: 'yurtici',
          trackingNo: 'TRK-999',
          status: 'in_transit',
          shippedAt: null,
          deliveredAt: null,
        },
      ],
    });
    renderPage();
    expect(screen.getByText('yurtici')).toBeInTheDocument();
    expect(screen.getByText(/TRK-999/)).toBeInTheDocument();
  });
});
