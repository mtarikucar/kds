import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { useHasFeature, useLimit } from './entitlementsApi';

// Stub the api client so the hook can resolve without a network round-trip.
vi.mock('../../lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from '../../lib/api';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('entitlements hooks', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('useHasFeature returns false until data arrives, then matches the engine output', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        features: { 'feature.kds': true, 'feature.advancedReports': false },
        limits: {},
        integrations: {},
        computedAt: new Date().toISOString(),
      },
    });

    const { result, rerender } = renderHook(() => useHasFeature('feature.kds'), { wrapper });
    expect(result.current).toBe(false);   // before resolution

    // Wait one microtask + a tick for react-query to settle.
    await new Promise((r) => setTimeout(r, 50));
    rerender();
    expect(result.current).toBe(true);
  });

  it('useLimit recognises -1 as unlimited', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { features: {}, limits: { 'limit.maxTables': -1 }, integrations: {}, computedAt: '' },
    });

    const { result, rerender } = renderHook(() => useLimit('limit.maxTables'), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    rerender();

    expect(result.current.value).toBe(-1);
    expect(result.current.unlimited).toBe(true);
  });
});
