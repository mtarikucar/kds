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

import { useSalesReport, useTopProducts } from './reportsApi';

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
});
