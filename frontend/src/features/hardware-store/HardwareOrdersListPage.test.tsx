import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state: { data: any[]; isLoading: boolean; error: unknown } = {
  data: [],
  isLoading: false,
  error: null,
};
let lastStatus: unknown = undefined;
vi.mock('./storeApi', () => ({
  useListHardwareOrders: (status: unknown) => {
    lastStatus = status;
    return state;
  },
}));

import HardwareOrdersListPage from './HardwareOrdersListPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <HardwareOrdersListPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.data = [];
  state.isLoading = false;
  state.error = null;
  lastStatus = undefined;
});

describe('HardwareOrdersListPage', () => {
  it('shows the loading state', () => {
    state.isLoading = true;
    renderPage();
    expect(screen.getByText('ordersList.loading')).toBeInTheDocument();
  });

  it('shows the error state', () => {
    state.error = new Error('boom');
    renderPage();
    expect(screen.getByText('ordersList.loadError')).toBeInTheDocument();
  });

  it('shows the empty state with a go-to-store link', () => {
    renderPage();
    expect(screen.getByText('ordersList.empty')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'ordersList.goToStore' }),
    ).toHaveAttribute('href', '/admin/store?tab=hardware');
  });

  it('renders order rows with a short id and a detail link', () => {
    state.data = [
      {
        id: 'abcdef0123456789',
        status: 'paid',
        totalCents: 12345,
        currency: 'TRY',
        installation: null,
        itemCount: 2,
        createdAt: '2024-01-15T00:00:00Z',
      },
    ];
    renderPage();
    const row = screen.getByText('#abcdef01').closest('tr')!;
    expect(within(row).getByText('2')).toBeInTheDocument();
    const detail = within(row).getByRole('link');
    expect(detail).toHaveAttribute(
      'href',
      '/admin/hardware-orders/abcdef0123456789',
    );
  });

  it('passes the chosen status filter to the query (undefined for "all")', () => {
    renderPage();
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'shipped' } });
    expect(lastStatus).toBe('shipped');

    fireEvent.change(select, { target: { value: '' } });
    expect(lastStatus).toBeUndefined();
  });

  // v3.7.0 — backend never returns an itemCount field for a service-only
  // print3d order (HardwareOrder has no HardwareOrderItem rows), so the
  // column read from the wrong field and rendered blank.
  it('shows the print3d item count for a service-only order', () => {
    state.data = [
      {
        id: 'order-p3d',
        status: 'paid',
        totalCents: 185000,
        currency: 'TRY',
        installation: null,
        itemCount: undefined,
        createdAt: '2026-08-20T00:00:00Z',
        print3dJob: {
          id: 'job-1',
          status: 'queued',
          itemCount: 7,
          totalCents: 185000,
          partner: 'figurunica',
          items: [],
        },
      },
    ];
    renderPage();
    const row = screen.getByText('#order-p3').closest('tr')!;
    expect(within(row).getByText('7')).toBeInTheDocument();
  });
});
