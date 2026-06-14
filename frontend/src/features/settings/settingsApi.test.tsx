import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    patch: (...a: unknown[]) => h.patch(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));

import {
  IntegrationType,
  useGetIntegrations,
  useGetIntegration,
  useCreateIntegration,
  useUpdateIntegration,
  useDeleteIntegration,
  useToggleIntegration,
  useSyncIntegration,
} from './settingsApi';

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

describe('settingsApi queries', () => {
  it('useGetIntegrations omits params when no type given', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useGetIntegrations(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/admin/settings/integrations', {
        params: undefined,
      }),
    );
  });

  it('useGetIntegrations forwards a type filter', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useGetIntegrations('PAYMENT_GATEWAY'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/admin/settings/integrations', {
        params: { type: 'PAYMENT_GATEWAY' },
      }),
    );
  });

  it('useGetIntegration is disabled without an id', () => {
    const { result } = renderHook(() => useGetIntegration(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useGetIntegration fetches by id when provided', async () => {
    h.get.mockResolvedValue({ data: { id: 'i1' } });
    renderHook(() => useGetIntegration('i1'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/admin/settings/integrations/i1'),
    );
  });
});

describe('settingsApi mutations invalidate the integrations list', () => {
  it('useCreateIntegration POSTs the dto', async () => {
    h.post.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateIntegration(), { wrapper });
    await result.current.mutateAsync({
      integrationType: IntegrationType.CRM,
      provider: 'x',
      name: 'n',
      config: {},
    });
    expect(h.post).toHaveBeenCalledWith(
      '/admin/settings/integrations',
      expect.objectContaining({ provider: 'x' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations'] });
  });

  it('useUpdateIntegration PATCHes by id', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useUpdateIntegration(), { wrapper });
    await result.current.mutateAsync({ id: 'i1', data: { name: 'new' } });
    expect(h.patch).toHaveBeenCalledWith('/admin/settings/integrations/i1', {
      name: 'new',
    });
  });

  it('useDeleteIntegration DELETEs by id', async () => {
    h.del.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useDeleteIntegration(), { wrapper });
    await result.current.mutateAsync('i1');
    expect(h.del).toHaveBeenCalledWith('/admin/settings/integrations/i1');
  });

  it('useToggleIntegration PATCHes the toggle endpoint', async () => {
    h.patch.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useToggleIntegration(), { wrapper });
    await result.current.mutateAsync({ id: 'i1', isEnabled: true });
    expect(h.patch).toHaveBeenCalledWith(
      '/admin/settings/integrations/i1/toggle',
      { isEnabled: true },
    );
  });

  it('useSyncIntegration POSTs the sync endpoint', async () => {
    h.post.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useSyncIntegration(), { wrapper });
    await result.current.mutateAsync('i1');
    expect(h.post).toHaveBeenCalledWith('/admin/settings/integrations/i1/sync');
  });
});
