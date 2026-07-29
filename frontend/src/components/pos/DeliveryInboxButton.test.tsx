import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DELIVERY_INBOX_ACTIVE_STATUSES } from './deliveryInbox';

/**
 * Specs for the persistent delivery-inbox opener. Pins the three things the
 * button exists for: it renders even when NOTHING is pending (the
 * NotificationBar hides at 0 counts — this button must not), its badge
 * counts only DELIVERY orders in the active window, and it reuses the
 * PendingOrdersPanel's exact query filters (shared react-query cache entry).
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

let ordersResult: any;
const useOrdersMock = vi.fn((..._args: unknown[]) => ordersResult);
vi.mock('../../features/orders/ordersApi', () => ({
  useOrders: (...args: unknown[]) => useOrdersMock(...args),
}));

import DeliveryInboxButton from './DeliveryInboxButton';

const deliveryOrder = (id: string, status: string) => ({
  id,
  status,
  source: 'TRENDYOL',
  externalOrderId: `ext-${id}`,
});
const internalOrder = (id: string, status: string) => ({ id, status });

beforeEach(() => {
  vi.clearAllMocks();
  ordersResult = { data: [] };
});

describe('DeliveryInboxButton', () => {
  it('renders without a badge when there are no active delivery orders', () => {
    ordersResult = { data: [internalOrder('i1', 'PENDING_APPROVAL')] };
    render(<DeliveryInboxButton onOpen={() => {}} />);
    const button = screen.getByRole('button', { name: 'title' });
    expect(button).toBeInTheDocument();
    expect(button.textContent).toBe('');
  });

  it('badges the count of delivery orders only (accepted PREPARING included)', () => {
    ordersResult = {
      data: [
        deliveryOrder('d1', 'PREPARING'),
        deliveryOrder('d2', 'PREPARING'),
        deliveryOrder('d3', 'READY'),
        internalOrder('i1', 'PENDING_APPROVAL'),
      ],
    };
    render(<DeliveryInboxButton onOpen={() => {}} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('queries the shared inbox active window (same key as PendingOrdersPanel)', () => {
    render(<DeliveryInboxButton onOpen={() => {}} />);
    expect(useOrdersMock).toHaveBeenCalledWith({
      status: DELIVERY_INBOX_ACTIVE_STATUSES,
    });
  });

  it('fires onOpen on click', () => {
    const onOpen = vi.fn();
    render(<DeliveryInboxButton onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'title' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
