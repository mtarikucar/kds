import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  api: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => h.toastSuccess(m), error: (m: string) => h.toastError(m) },
}));

import {
  webhookKeys,
  useListWebhooks,
  useCreateWebhook,
  useRevokeWebhook,
} from './webhooksApi';

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

describe('webhooksApi', () => {
  it('exposes the canonical webhook query key', () => {
    expect(webhookKeys.all).toEqual(['webhooks']);
  });

  it('useListWebhooks GETs the subscriptions endpoint', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListWebhooks(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/webhooks/subscriptions'),
    );
  });

  it('useCreateWebhook POSTs, invalidates and toasts the secret warning', async () => {
    h.post.mockResolvedValue({ data: { id: 'w1', secret: 'shh' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateWebhook(), { wrapper });
    await result.current.mutateAsync({ url: 'https://x', events: ['order.created'] });
    expect(h.post).toHaveBeenCalledWith('/v1/webhooks/subscriptions', {
      url: 'https://x',
      events: ['order.created'],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: webhookKeys.all });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useRevokeWebhook DELETEs by id and invalidates', async () => {
    h.del.mockResolvedValue({ data: undefined });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeWebhook(), { wrapper });
    await result.current.mutateAsync('w9');
    expect(h.del).toHaveBeenCalledWith('/v1/webhooks/subscriptions/w9');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: webhookKeys.all });
  });
});
