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
  it('passes filters as query params', async () => {
    get.mockResolvedValue({ data: [] });
    renderHook(() => useListLegalDocuments({ kind: 'PRIVACY_POLICY' }), {
      wrapper,
    });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/superadmin/legal/documents', {
        params: { kind: 'PRIVACY_POLICY' },
      }),
    );
  });
});

describe('usePublishLegalDocument', () => {
  it('POSTs the input and invalidates the legal cache', async () => {
    post.mockResolvedValue({ data: { id: 'new' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => usePublishLegalDocument(), { wrapper });
    await result.current.mutateAsync({
      kind: 'TERMS_OF_SERVICE',
      version: '2',
      locale: 'tr',
      title: 'T',
      bodyMarkdown: 'body',
    });
    expect(post).toHaveBeenCalledWith(
      '/superadmin/legal/documents/publish',
      expect.objectContaining({ kind: 'TERMS_OF_SERVICE' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: legalKeys.all });
  });
});
