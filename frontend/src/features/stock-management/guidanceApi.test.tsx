import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('../../lib/api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string }) => unknown) => sel({ branchId: 'b1' }),
}));

import api from '../../lib/api';
import { useGuidance, guidanceKeys } from './guidanceApi';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useGuidance', () => {
  it('GETs the guidance endpoint and keys by branch', async () => {
    (api.get as any).mockResolvedValue({ data: { volumeTier: 'SMALL_CAFE', buyList: [], channelGuide: [] } });
    const { result } = renderHook(() => useGuidance(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/stock-management/guidance');
    expect(result.current.data?.volumeTier).toBe('SMALL_CAFE');
    expect(guidanceKeys.guidance('b1')).toEqual(['stock', 'guidance', 'b1']);
  });
});
