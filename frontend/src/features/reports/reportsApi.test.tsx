import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api', () => ({
  default: { get: (...a: unknown[]) => h.get(...a) },
}));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));

import {
  useSalesReport,
  useTopProducts,
  useSalesComparison,
  metricTrend,
  downloadSalesCsv,
  type SalesComparison,
} from './reportsApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

const range = { startDate: '2024-01-01', endDate: '2024-01-31' };

describe('reportsApi', () => {
  it('useSalesReport is disabled until both dates are present', () => {
    const { result } = renderHook(
      () => useSalesReport({ startDate: '', endDate: '' } as never),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useSalesReport GETs /reports/sales with the date params', async () => {
    h.get.mockResolvedValue({ data: { total: 100 } });
    renderHook(() => useSalesReport(range as never), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/reports/sales', { params: range }),
    );
  });

  it('useTopProducts returns the products array', async () => {
    h.get.mockResolvedValue({ data: { products: [{ id: 'p1' }] } });
    const { result } = renderHook(() => useTopProducts(range as never), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'p1' }]);
  });

  it('useTopProducts defaults to an empty array when products is absent', async () => {
    h.get.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useTopProducts(range as never), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('useSalesComparison GETs /reports/sales-comparison with the date params', async () => {
    h.get.mockResolvedValue({ data: { metrics: [] } });
    renderHook(() => useSalesComparison(range as never), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/reports/sales-comparison', {
        params: range,
      }),
    );
  });

  it('useSalesComparison is disabled until both dates are present', () => {
    const { result } = renderHook(
      () => useSalesComparison({ startDate: '', endDate: '' } as never),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });
});

describe('metricTrend', () => {
  const comparison = {
    current: { startDate: '', endDate: '' },
    previous: { startDate: '', endDate: '' },
    metrics: [
      { metric: 'totalSales', current: 120, previous: 100, change: 20, changePct: 20 },
      { metric: 'totalOrders', current: 8, previous: 10, change: -2, changePct: -20 },
      { metric: 'averageOrderValue', current: 15, previous: 0, change: 15, changePct: null },
    ],
    foodCostPct: { current: null, previous: null },
  } satisfies SalesComparison;

  it('maps a positive change to an upward trend', () => {
    expect(metricTrend(comparison, 'totalSales')).toEqual({
      value: 20,
      isPositive: true,
    });
  });

  it('maps a negative change to a downward trend with an absolute value', () => {
    expect(metricTrend(comparison, 'totalOrders')).toEqual({
      value: 20,
      isPositive: false,
    });
  });

  it('returns undefined when the previous window had no data (changePct null)', () => {
    expect(metricTrend(comparison, 'averageOrderValue')).toBeUndefined();
  });

  it('returns undefined when the comparison payload is absent or the metric unknown', () => {
    expect(metricTrend(undefined, 'totalSales')).toBeUndefined();
    expect(metricTrend(comparison, 'nope')).toBeUndefined();
  });
});

describe('downloadSalesCsv', () => {
  it('fetches the CSV as a blob and triggers an anchor download', async () => {
    h.get.mockResolvedValue({ data: 'date,orders,sales\n2024-01-01,3,42\n' });
    const createObjectURL = vi.fn(() => 'blob:sales');
    const revokeObjectURL = vi.fn();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
    let downloadName = '';
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadName = this.download;
      });

    await downloadSalesCsv({ startDate: '2024-01-01', endDate: '2024-01-31' });

    expect(h.get).toHaveBeenCalledWith('/reports/sales.csv', {
      params: { startDate: '2024-01-01', endDate: '2024-01-31' },
      responseType: 'blob',
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadName).toBe('sales_2024-01-01_2024-01-31.csv');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:sales');
    click.mockRestore();
  });
});
