import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    patch: (...a: unknown[]) => h.patch(...a),
  },
}));

import { useGetSmsSettings, useUpdateSmsSettings } from './smsSettingsApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  h.get.mockReset();
  h.patch.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('smsSettingsApi', () => {
  it('useGetSmsSettings GETs /sms-settings', async () => {
    h.get.mockResolvedValue({ data: { id: 's1', isEnabled: true } });
    const { result } = renderHook(() => useGetSmsSettings(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.get).toHaveBeenCalledWith('/sms-settings');
    expect(result.current.data?.isEnabled).toBe(true);
  });

  it('useUpdateSmsSettings PATCHes /sms-settings and invalidates the cache', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateSmsSettings(), { wrapper });
    await result.current.mutateAsync({ smsOnOrderReady: true });
    expect(h.patch).toHaveBeenCalledWith('/sms-settings', {
      smsOnOrderReady: true,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['smsSettings'] });
  });
});
