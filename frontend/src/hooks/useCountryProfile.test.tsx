import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getMock = vi.fn();
vi.mock('../lib/api', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    patch: vi.fn(),
  },
}));

import { useCountryProfile } from './useCountryProfile';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCountryProfile', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('falls back to the Turkish band before settings load (deliberate — todays existing behaviour)', () => {
    getMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCountryProfile(), { wrapper });
    expect(result.current).toEqual({
      countryCode: 'TR',
      taxRates: [0, 1, 10, 20],
      defaultTaxRate: 10,
    });
  });

  it('surfaces the TR profile once settings load for a TR tenant', async () => {
    getMock.mockResolvedValue({
      data: { id: 't1', countryCode: 'TR', taxRates: [0, 1, 10, 20], defaultTaxRate: 10 },
    });
    const { result } = renderHook(() => useCountryProfile(), { wrapper });
    await waitFor(() => expect(result.current.countryCode).toBe('TR'));
    expect(result.current.taxRates).toEqual([0, 1, 10, 20]);
    expect(result.current.defaultTaxRate).toBe(10);
  });

  it("surfaces the UZ tenant's OWN band (0/6/12), not Turkey's", async () => {
    getMock.mockResolvedValue({
      data: { id: 't2', countryCode: 'UZ', taxRates: [0, 6, 12], defaultTaxRate: 12 },
    });
    const { result } = renderHook(() => useCountryProfile(), { wrapper });
    await waitFor(() => expect(result.current.countryCode).toBe('UZ'));
    expect(result.current.taxRates).toEqual([0, 6, 12]);
    expect(result.current.defaultTaxRate).toBe(12);
  });
});
