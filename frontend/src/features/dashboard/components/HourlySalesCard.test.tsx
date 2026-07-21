import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HourlySalesCard from './HourlySalesCard';

vi.mock('../../../api/enhancedReportsApi', () => ({
  useOrdersByHour: () => globalThis.__hourly,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => globalThis.__features.includes(k) }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

declare global {
  /* eslint-disable no-var */
  var __hourly: any;
  var __features: string[];
  /* eslint-enable no-var */
}

const hourly = (overrides: Record<number, { orderCount: number; totalSales: number }>) => ({
  date: '2026-07-21',
  hourlyData: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orderCount: overrides[hour]?.orderCount ?? 0,
    totalSales: overrides[hour]?.totalSales ?? 0,
  })),
});

const renderCard = () =>
  render(
    <MemoryRouter>
      <HourlySalesCard />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 21, 15, 0, 0)); // 15:00
});
afterEach(() => vi.useRealTimers());

describe('HourlySalesCard', () => {
  it('renders nothing without advancedReports', () => {
    globalThis.__features = [];
    const { container } = renderCard();
    expect(container.firstChild?.firstChild ?? null).toBeNull();
  });

  it('renders bars only for the active window (first data hour → current hour)', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = {
      data: hourly({ 9: { orderCount: 3, totalSales: 450 }, 12: { orderCount: 8, totalSales: 1200 } }),
      isLoading: false,
      isError: false,
    };
    renderCard();
    const bars = screen.getAllByTestId('hour-bar');
    // window 9..15 inclusive = 7 bars
    expect(bars).toHaveLength(7);
    expect(bars[3]).toHaveAttribute('title', expect.stringContaining('₺1200'));
  });

  it('shows the empty state when the day has no sales', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = { data: hourly({}), isLoading: false, isError: false };
    renderCard();
    expect(screen.getByTestId('widget-empty')).toHaveTextContent('dashboard.noSalesYet');
  });

  it('shows the soft error line on failure', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = { data: undefined, isLoading: false, isError: true };
    renderCard();
    expect(screen.getByTestId('widget-error')).toBeInTheDocument();
  });

  it('links to the detailed report', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__hourly = { data: hourly({ 12: { orderCount: 1, totalSales: 100 } }), isLoading: false, isError: false };
    renderCard();
    expect(screen.getByRole('link', { name: /dashboard\.detailedReport/ })).toHaveAttribute('href', '/admin/reports');
  });
});
