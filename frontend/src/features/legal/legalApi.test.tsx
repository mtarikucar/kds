import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}));

// F1: the /superadmin/legal/* admin hooks go through the SUPERADMIN axios
// instance (the tenant client would 401 → tenant logout+redirect). Mock it
// separately so the tests pin each hook to the correct client.
const saGet = vi.fn();
const saPost = vi.fn();
vi.mock('../superadmin/api/superAdminApi', () => ({
  superAdminApi: {
    get: (...a: unknown[]) => saGet(...a),
    post: (...a: unknown[]) => saPost(...a),
  },
}));

import {
  legalKeys,
  useGetCurrentLegalDocument,
  useListLegalDocuments,
  usePublishLegalDocument,
} from './legalApi';

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  saGet.mockReset();
  saPost.mockReset();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
});

describe('legalKeys', () => {
  it('builds stable, scoped query keys', () => {
    expect(legalKeys.all).toEqual(['legal']);
    expect(legalKeys.current('KVKK', 'en')).toEqual([
      'legal',
      'current',
      'KVKK',
      'en',
    ]);
    expect(legalKeys.current('KVKK')).toEqual([
      'legal',
      'current',
      'KVKK',
      'tr',
    ]);
    expect(legalKeys.list('TERMS_OF_SERVICE', 'tr')).toEqual([
      'legal',
      'list',
      { kind: 'TERMS_OF_SERVICE', locale: 'tr' },
    ]);
  });
});

describe('useGetCurrentLegalDocument', () => {
  it('fetches the current document for a kind/locale', async () => {
    get.mockResolvedValue({ data: { id: 'd1', kind: 'KVKK' } });
    const { result } = renderHook(
      () => useGetCurrentLegalDocument('KVKK', 'en'),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith('/legal/documents/KVKK/current', {
      params: { locale: 'en' },
    });
    expect(result.current.data?.id).toBe('d1');
  });

  it('defaults the locale to tr', async () => {
    get.mockResolvedValue({ data: {} });
    renderHook(() => useGetCurrentLegalDocument('REFUND_POLICY'), { wrapper });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/legal/documents/REFUND_POLICY/current', {
        params: { locale: 'tr' },
      }),
    );
  });
});

describe('useListLegalDocuments', () => {
  it('passes filters as query params through the SUPERADMIN client', async () => {
    saGet.mockResolvedValue({ data: [] });
    renderHook(() => useListLegalDocuments({ kind: 'PRIVACY_POLICY' }), {
      wrapper,
    });
    await waitFor(() =>
      expect(saGet).toHaveBeenCalledWith('/superadmin/legal/documents', {
        params: { kind: 'PRIVACY_POLICY' },
      }),
    );
    // Regression: must NOT hit the tenant client — a superadmin session has
    // no tenant token, so that path 401s and force-logs-out the tenant app.
    expect(get).not.toHaveBeenCalled();
  });
});

describe('usePublishLegalDocument', () => {
  it('POSTs the input through the SUPERADMIN client and invalidates the legal cache', async () => {
    saPost.mockResolvedValue({ data: { id: 'new' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePublishLegalDocument(), { wrapper });
    await result.current.mutateAsync({
      kind: 'TERMS_OF_SERVICE',
      version: '2',
      locale: 'tr',
      title: 'T',
      bodyMarkdown: 'body',
    });
    expect(saPost).toHaveBeenCalledWith(
      '/superadmin/legal/documents/publish',
      expect.objectContaining({ kind: 'TERMS_OF_SERVICE' }),
    );
    expect(post).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: legalKeys.all });
  });

  it('toasts through getApiErrorMessage when the publish fails (onError wired)', async () => {
    const { toast } = await import('sonner');
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '' as any);
    saPost.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePublishLegalDocument(), { wrapper });
    await expect(
      result.current.mutateAsync({
        kind: 'KVKK',
        version: '2',
        locale: 'tr',
        title: 'T',
        bodyMarkdown: 'body',
      }),
    ).rejects.toThrow('boom');
    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
  });
});
