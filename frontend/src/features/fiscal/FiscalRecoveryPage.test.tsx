import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  list: { data: [] as any[], isLoading: false, refetch: vi.fn() },
  retry: { mutate: vi.fn(), isPending: false },
}));
vi.mock('./fiscalApi', () => ({
  useListPendingReceipts: () => h.list,
  useRetryReceipt: () => h.retry,
}));

import FiscalRecoveryPage from './FiscalRecoveryPage';

beforeEach(() => {
  h.list.data = [];
  h.list.isLoading = false;
  h.list.refetch = vi.fn();
  h.retry.mutate = vi.fn();
  h.retry.isPending = false;
});

function makeReceipt(over: Partial<any> = {}) {
  return {
    id: 'r1',
    providerId: 'prov-1',
    orderId: 'ord-1',
    status: 'failed',
    attempts: 2,
    lastError: 'device offline',
    totalCents: 5000,
    currency: 'TRY',
    createdAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

describe('FiscalRecoveryPage', () => {
  it('shows the loading state', () => {
    h.list.isLoading = true;
    render(<FiscalRecoveryPage />);
    // The `common` namespace is loaded in the test harness, so the key
    // resolves to its English string.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('shows the empty state', () => {
    render(<FiscalRecoveryPage />);
    expect(
      screen.getByText(/No pending or failed receipts/),
    ).toBeInTheDocument();
  });

  it('renders a pending receipt row with status, attempts and error', () => {
    h.list.data = [makeReceipt()];
    render(<FiscalRecoveryPage />);
    const row = screen.getByText('prov-1').closest('tr')!;
    expect(within(row).getByText('failed')).toBeInTheDocument();
    expect(within(row).getByText('×2')).toBeInTheDocument();
    expect(within(row).getByText('device offline')).toBeInTheDocument();
  });

  it('retries a receipt by id when the Retry button is clicked', () => {
    h.list.data = [makeReceipt()];
    render(<FiscalRecoveryPage />);
    const row = screen.getByText('prov-1').closest('tr')!;
    fireEvent.click(within(row).getByRole('button'));
    expect(h.retry.mutate).toHaveBeenCalledWith('r1');
  });

  it('refetches when the refresh button is clicked', () => {
    render(<FiscalRecoveryPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.list.refetch).toHaveBeenCalledTimes(1);
  });
});
