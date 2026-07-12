import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => h.get(...a),
    post: (...a: unknown[]) => h.post(...a),
    put: (...a: unknown[]) => h.put(...a),
    delete: (...a: unknown[]) => h.del(...a),
  },
}));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string | null }) => unknown) =>
    sel({ branchId: 'branch-A' }),
}));

import {
  analyticsKeys,
  useOccupancyHeatmap,
  useUnderutilizedTables,
  useInsight,
  useUpdateInsightStatus,
  useGenerateInsights,
  useCreateCamera,
  useDeleteCamera,
  useSaveCameraCalibration,
  useGenerateMockData,
} from './analyticsApi';

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

describe('analyticsKeys', () => {
  it('nests keys under the analytics root', () => {
    expect(analyticsKeys.all).toEqual(['analytics']);
    expect(analyticsKeys.heatmaps()).toEqual(['analytics', 'heatmaps']);
    expect(analyticsKeys.insight('i1')).toEqual([
      'analytics',
      'insights',
      'i1',
    ]);
    expect(analyticsKeys.camera('c1')).toEqual([
      'analytics',
      'cameras',
      'c1',
    ]);
  });
});

describe('analytics queries', () => {
  it('useOccupancyHeatmap GETs the occupancy endpoint with params', async () => {
    h.get.mockResolvedValue({ data: { cells: [] } });
    renderHook(() => useOccupancyHeatmap({ from: 'a', to: 'b' } as never), {
      wrapper,
    });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/analytics/heatmap/occupancy', {
        params: { from: 'a', to: 'b' },
      }),
    );
  });

  it('useUnderutilizedTables omits params when no threshold given', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useUnderutilizedTables(), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/analytics/tables/underutilized', {
        params: undefined,
      }),
    );
  });

  it('useInsight is disabled without an id', () => {
    const { result } = renderHook(() => useInsight(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });
});

describe('analytics mutations', () => {
  it('useUpdateInsightStatus PUTs the status and invalidates insights', async () => {
    h.put.mockResolvedValue({ data: {} });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateInsightStatus(), { wrapper });
    await result.current.mutateAsync({ id: 'i1', status: 'dismissed' as never });
    expect(h.put).toHaveBeenCalledWith('/analytics/insights/i1/status', {
      status: 'dismissed',
      dismissedReason: undefined,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: analyticsKeys.insights(),
    });
  });

  it('useGenerateInsights POSTs and invalidates insights', async () => {
    h.post.mockResolvedValue({ data: { generated: 3 } });
    const { result } = renderHook(() => useGenerateInsights(), { wrapper });
    const out = await result.current.mutateAsync();
    expect(h.post).toHaveBeenCalledWith('/analytics/insights/generate');
    expect(out.generated).toBe(3);
  });

  it('useCreateCamera POSTs and invalidates cameras', async () => {
    h.post.mockResolvedValue({ data: { id: 'c1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCamera(), { wrapper });
    await result.current.mutateAsync({ name: 'Lobby' } as never);
    expect(h.post).toHaveBeenCalledWith('/analytics/cameras', { name: 'Lobby' });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: analyticsKeys.cameras(),
    });
  });

  it('useSaveCameraCalibration PUTs the calibration endpoint and invalidates cameras', async () => {
    // Backend route is PUT /analytics/cameras/:id/calibration — this hook
    // replaced a bare fetch() that POSTed (wrong method, no auth/branch
    // headers). The method + URL here are the contract.
    h.put.mockResolvedValue({ data: { id: 'c1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSaveCameraCalibration(), { wrapper });
    await result.current.mutateAsync({ id: 'c1', data: { points: [] } });
    expect(h.put).toHaveBeenCalledWith('/analytics/cameras/c1/calibration', {
      points: [],
    });
    expect(h.post).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: analyticsKeys.cameras(),
    });
  });

  it('useDeleteCamera DELETEs by id', async () => {
    h.del.mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useDeleteCamera(), { wrapper });
    await result.current.mutateAsync('c9');
    expect(h.del).toHaveBeenCalledWith('/analytics/cameras/c9');
  });

  it('useGenerateMockData POSTs with the days param and invalidates all analytics', async () => {
    h.post.mockResolvedValue({ data: { inserted: 1 } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useGenerateMockData(), { wrapper });
    await result.current.mutateAsync(7);
    expect(h.post).toHaveBeenCalledWith(
      '/analytics/mock-data/generate',
      {},
      { params: { days: 7 } },
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: analyticsKeys.all });
  });
});
