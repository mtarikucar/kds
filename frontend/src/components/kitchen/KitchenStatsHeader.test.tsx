import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import KitchenStatsHeader from './KitchenStatsHeader';

// Kitchen i18n bundle isn't loaded in the test setup; echo keys so chip
// titles are stable selectors (kitchen.stats.activeOrders, etc.).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const NOW = new Date('2026-07-21T12:00:00.000Z');

// Order aged `minutes` relative to the frozen clock. Only createdAt matters
// to the chips (avg wait + urgency are pure functions of order age).
function orderAgedMinutes(minutes: number, id = `o-${minutes}`): any {
  return {
    id,
    orderNumber: '1001',
    status: 'PENDING',
    createdAt: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
    orderItems: [],
  };
}

function renderHeader(over: Partial<Parameters<typeof KitchenStatsHeader>[0]> = {}) {
  const onRefresh = vi.fn();
  const utils = render(
    <KitchenStatsHeader
      orders={[]}
      isConnected
      onRefresh={onRefresh}
      isLoading={false}
      {...over}
    />
  );
  return { ...utils, onRefresh };
}

describe('KitchenStatsHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a single compact row — no stats-card grid, no subtitle', () => {
    const { container } = renderHeader({ orders: [orderAgedMinutes(2)] });

    expect(container.querySelector('.grid.grid-cols-3')).toBeNull();
    expect(screen.getByRole('heading', { name: 'kitchen.title' })).toBeInTheDocument();
    expect(screen.queryByText('kitchen.realtimeTracking')).toBeNull();
  });

  it('chips surface total / avg wait / urgent for the crafted orders', () => {
    // 5 min (attention) + 15 min (critical → urgent) → total 2, avg 10 min.
    renderHeader({ orders: [orderAgedMinutes(5), orderAgedMinutes(15)] });

    expect(screen.getByTitle('kitchen.stats.activeOrders')).toHaveTextContent('2');
    expect(screen.getByTitle('kitchen.stats.avgWaitTime')).toHaveTextContent('10m 00s');
    const urgent = screen.getByTitle('kitchen.stats.urgentOrders');
    expect(urgent).toHaveTextContent('1');
    expect(urgent.className).toContain('animate-pulse');
  });

  it('re-renders the avg-wait chip on the 1s ticker', () => {
    renderHeader({ orders: [orderAgedMinutes(5), orderAgedMinutes(15)] });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // A minute later both orders are a minute older → avg 11 min.
    expect(screen.getByTitle('kitchen.stats.avgWaitTime')).toHaveTextContent('11m 00s');
  });

  it('omits the urgent chip when nothing is urgent', () => {
    renderHeader({ orders: [orderAgedMinutes(2), orderAgedMinutes(3)] });

    expect(screen.queryByTitle('kitchen.stats.urgentOrders')).toBeNull();
    expect(screen.getByTitle('kitchen.stats.avgWaitTime')).toBeInTheDocument();
  });

  it('omits the avg-wait chip with zero orders but still shows the count chip', () => {
    renderHeader({ orders: [] });

    expect(screen.getByTitle('kitchen.stats.activeOrders')).toHaveTextContent('0');
    expect(screen.queryByTitle('kitchen.stats.avgWaitTime')).toBeNull();
    expect(screen.queryByTitle('kitchen.stats.urgentOrders')).toBeNull();
  });

  it('invokes onRefresh from the refresh button', () => {
    const { onRefresh } = renderHeader();

    fireEvent.click(screen.getByText('common:buttons.refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows the amber disconnect banner only while the socket is down', () => {
    const { unmount } = renderHeader({ isConnected: false });
    expect(screen.getByRole('alert')).toHaveTextContent('kitchen.socketDownBanner');
    unmount();

    renderHeader({ isConnected: true });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
