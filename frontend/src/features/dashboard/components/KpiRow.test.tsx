import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SalesKpis, OpenTablesKpi } from './KpiRow';

vi.mock('../../reports/reportsApi', () => ({
  useSalesReport: () => globalThis.__sales,
  useSalesComparison: () => globalThis.__comparison,
  metricTrend: (_c: unknown, metric: string) =>
    metric === 'totalSales' ? { value: 8, isPositive: true } : undefined,
}));
vi.mock('../../tables/tablesApi', () => ({
  useTables: () => globalThis.__tables,
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
  var __sales: any;
  var __comparison: any;
  var __tables: any;
  var __features: string[];
  /* eslint-enable no-var */
}

describe('SalesKpis', () => {
  it('renders nothing without advancedReports (gate wrapper)', () => {
    globalThis.__features = [];
    globalThis.__sales = { data: undefined, isLoading: false, isError: false };
    globalThis.__comparison = { data: undefined };
    const { container } = render(<SalesKpis />);
    expect(container.firstChild).toBeNull();
  });

  it('renders sales, orders and avg basket with trend when entitled', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__sales = {
      data: { totalSales: 12450, totalOrders: 86, averageOrderValue: 145 },
      isLoading: false,
      isError: false,
    };
    globalThis.__comparison = { data: {} };
    render(<SalesKpis />);
    expect(screen.getByText('₺12450')).toBeInTheDocument();
    expect(screen.getByText('86')).toBeInTheDocument();
    expect(screen.getByText('₺145')).toBeInTheDocument();
    expect(screen.getByText(/↑ %8/)).toBeInTheDocument();
  });
});

describe('OpenTablesKpi', () => {
  it('shows occupied/total from useTables', () => {
    globalThis.__features = [];
    globalThis.__tables = {
      data: [{ status: 'OCCUPIED' }, { status: 'OCCUPIED' }, { status: 'AVAILABLE' }],
      isLoading: false,
      isError: false,
    };
    render(<OpenTablesKpi />);
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('renders nothing on error (fails soft, page stays intact)', () => {
    globalThis.__tables = { data: undefined, isLoading: false, isError: true };
    const { container } = render(<OpenTablesKpi />);
    expect(container.firstChild).toBeNull();
  });
});
