import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getMock = vi.fn();
const patchMock = vi.fn();
vi.mock('../lib/api', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
  },
}));

import {
  useCurrency,
  useGetTenantSettings,
  useUpdateTenantSettings,
  SUPPORTED_CURRENCIES,
} from './useCurrency';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useCurrency hooks', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('exposes only Turkish Lira (TRY-only platform)', () => {
    expect(SUPPORTED_CURRENCIES.map((c) => c.code)).toEqual(['TRY']);
  });

  it('useGetTenantSettings calls the settings endpoint and returns data', async () => {
    getMock.mockResolvedValue({ data: { id: 't1', currency: 'EUR', name: 'X' } });
    const { result } = renderHook(() => useGetTenantSettings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/tenants/settings');
    expect(result.current.data?.currency).toBe('EUR');
  });

  it('useCurrency returns the tenant currency when loaded', async () => {
    getMock.mockResolvedValue({ data: { id: 't1', currency: 'GBP', name: 'X' } });
    const { result } = renderHook(() => useCurrency(), { wrapper });
    await waitFor(() => expect(result.current).toBe('GBP'));
  });

  it('useCurrency falls back to TRY before data loads', () => {
    getMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCurrency(), { wrapper });
    expect(result.current).toBe('TRY');
  });

  it('useUpdateTenantSettings PATCHes the settings endpoint', async () => {
    patchMock.mockResolvedValue({ data: { ok: true } });
    const { result } = renderHook(() => useUpdateTenantSettings(), { wrapper });
    await result.current.mutateAsync({ currency: 'USD' });
    expect(patchMock).toHaveBeenCalledWith('/tenants/settings', {
      currency: 'USD',
    });
  });
});
