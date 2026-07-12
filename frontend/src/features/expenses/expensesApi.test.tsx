import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('../../lib/api', () => ({
  default: { patch: (...a: unknown[]) => h.patch(...a) },
}));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));

import { useUpdateExpense } from './expensesApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.patch.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});

describe('useUpdateExpense', () => {
  it('PATCHes /expenses/:id with the changed fields only (id stays in the URL)', async () => {
    h.patch.mockResolvedValue({ data: { id: 'e1', amount: 12 } });
    const { result } = renderHook(() => useUpdateExpense(), { wrapper });
    result.current.mutate({ id: 'e1', amount: 12, description: 'Su' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.patch).toHaveBeenCalledWith('/expenses/e1', {
      amount: 12,
      description: 'Su',
    });
  });

  it('invalidates the expenses cache on success so lists/summaries refetch', async () => {
    h.patch.mockResolvedValue({ data: { id: 'e1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateExpense(), { wrapper });
    result.current.mutate({ id: 'e1', amount: 5 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expenses'] });
  });

  it('surfaces a backend failure as isError (endpoint ships in a separate PR)', async () => {
    h.patch.mockRejectedValue(new Error('404'));
    const { result } = renderHook(() => useUpdateExpense(), { wrapper });
    result.current.mutate({ id: 'e1', amount: 5 });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
