import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    patch: (...a: unknown[]) => h.patch(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));

import {
  useDeliveryPlatformConfigs,
  useDeliveryPlatformConfig,
  useCreatePlatformConfig,
  useUpdatePlatformConfig,
  useDeletePlatformConfig,
  useTestPlatformConnection,
  useToggleRestaurant,
  useDeliveryPlatformLogs,
  useSyncMenu,
} from './deliveryPlatformsApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  Object.values(h).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset());
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('deliveryPlatformsApi queries', () => {
  it('useDeliveryPlatformConfigs GETs the configs list', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useDeliveryPlatformConfigs(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/delivery-platforms/configs'),
    );
  });

  it('useDeliveryPlatformConfig is disabled with an empty platform', () => {
    const { result } = renderHook(() => useDeliveryPlatformConfig(''), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useDeliveryPlatformConfig fetches a specific platform', async () => {
    h.get.mockResolvedValue({ data: {} });
    renderHook(() => useDeliveryPlatformConfig('getir'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/delivery-platforms/configs/getir'),
    );
  });

  it('useDeliveryPlatformLogs forwards filter params', async () => {
    h.get.mockResolvedValue({ data: { logs: [], total: 0 } });
    renderHook(() => useDeliveryPlatformLogs({ platform: 'getir', limit: 10 }), {
      wrapper,
    });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/delivery-platforms/logs', {
        params: { platform: 'getir', limit: 10 },
      }),
    );
  });
});

describe('deliveryPlatformsApi mutations', () => {
  it('useCreatePlatformConfig POSTs and invalidates configs', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreatePlatformConfig(), { wrapper });
    await result.current.mutateAsync({ platform: 'getir' });
    expect(h.post).toHaveBeenCalledWith('/delivery-platforms/configs', {
      platform: 'getir',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['deliveryPlatformConfigs'],
    });
  });

  it('useUpdatePlatformConfig PATCHes a platform with the rest of the payload', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useUpdatePlatformConfig(), { wrapper });
    await result.current.mutateAsync({ platform: 'getir', isEnabled: true });
    expect(h.patch).toHaveBeenCalledWith('/delivery-platforms/configs/getir', {
      isEnabled: true,
    });
  });

  it('useDeletePlatformConfig DELETEs a platform', async () => {
    h.del.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useDeletePlatformConfig(), { wrapper });
    await result.current.mutateAsync('getir');
    expect(h.del).toHaveBeenCalledWith('/delivery-platforms/configs/getir');
  });

  it('useTestPlatformConnection toasts success when the test passes', async () => {
    h.post.mockResolvedValue({ data: { success: true } });
    const { result } = renderHook(() => useTestPlatformConnection(), {
      wrapper,
    });
    await result.current.mutateAsync('getir');
    expect(h.post).toHaveBeenCalledWith('/delivery-platforms/configs/getir/test');
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useTestPlatformConnection toasts an error when the test fails', async () => {
    h.post.mockResolvedValue({ data: { success: false } });
    const { result } = renderHook(() => useTestPlatformConnection(), {
      wrapper,
    });
    await result.current.mutateAsync('getir');
    expect(h.toastError).toHaveBeenCalled();
  });

  it('useToggleRestaurant POSTs the open state', async () => {
    h.post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useToggleRestaurant(), { wrapper });
    await result.current.mutateAsync({ platform: 'getir', open: true });
    expect(h.post).toHaveBeenCalledWith(
      '/delivery-platforms/configs/getir/toggle-restaurant',
      { open: true },
    );
  });

  it('useSyncMenu POSTs the menu-sync endpoint', async () => {
    h.post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSyncMenu(), { wrapper });
    await result.current.mutateAsync('getir');
    expect(h.post).toHaveBeenCalledWith('/delivery-platforms/menu-sync/getir');
  });
});
