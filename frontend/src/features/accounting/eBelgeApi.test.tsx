import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
  },
}));

import { useIssueCreditNote } from './eBelgeApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  h.post.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('useIssueCreditNote', () => {
  it('POSTs the credit-note endpoint and invalidates the salesInvoices list', async () => {
    // Regression: the hook used the kebab key ['sales-invoices'] which never
    // matched the list query ['salesInvoices', ...], so a freshly-issued İade
    // Faturası stayed invisible until a manual reload.
    h.post.mockResolvedValue({ data: { id: 'refund-1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useIssueCreditNote(), { wrapper });

    await result.current.mutateAsync('inv-1');

    expect(h.post).toHaveBeenCalledWith('/sales-invoices/inv-1/credit-note');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['salesInvoices'] });
  });
});
