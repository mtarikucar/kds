import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: (...a: unknown[]) => h.get(...a) },
}));

import { callerKeys, useListCallerEvents } from './callerApi';

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

describe('callerApi', () => {
  it('exposes the recent caller-events key', () => {
    expect(callerKeys.recent).toEqual(['caller', 'recent']);
  });

  it('useListCallerEvents defaults the limit to 50', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListCallerEvents(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/caller/recent', {
        params: { limit: 50 },
      }),
    );
  });

  it('useListCallerEvents forwards a custom limit', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListCallerEvents(10), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/caller/recent', {
        params: { limit: 10 },
      }),
    );
  });
});
