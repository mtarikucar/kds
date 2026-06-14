import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: (...a: unknown[]) => h.get(...a) },
}));

import { healthKeys, useGetHealthOverview } from './healthApi';

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

describe('healthApi', () => {
  it('exposes the overview key', () => {
    expect(healthKeys.overview).toEqual(['health', 'overview']);
  });

  it('useGetHealthOverview GETs the branches health endpoint', async () => {
    h.get.mockResolvedValue({ data: [{ id: 'b1', name: 'Main' }] });
    const { result } = renderHook(() => useGetHealthOverview(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledWith('/v1/health/branches');
    expect(result.current.data?.[0].name).toBe('Main');
  });
});
