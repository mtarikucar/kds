import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

/**
 * Specs for personnelApi — representative coverage across each section
 * (attendance / shift-templates / schedule / swap / performance). The
 * query hooks bake branchId + params into their keys; the mutation hooks
 * hit the right verb+URL and invalidate the right scope. useApproveSwap
 * is the cross-cutting case: it invalidates BOTH swap-requests and
 * schedule (an approved swap rewrites the roster).
 */

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();
vi.mock('../../lib/api', () => ({
  default: {
    get: (...a: unknown[]) => getMock(...a),
    post: (...a: unknown[]) => postMock(...a),
    patch: (...a: unknown[]) => patchMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../i18n/config', () => ({ default: { t: (k: string) => k } }));
vi.mock('../../store/branchScopeStore', () => ({
  useBranchScopeStore: (selector: (s: any) => unknown) => selector({ branchId: 'b-2' }),
}));

import {
  useAttendanceList,
  useClockIn,
  useShiftTemplates,
  useWeeklySchedule,
  useApproveSwap,
  usePerformanceMetrics,
} from './personnelApi';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useAttendanceList', () => {
  it('respects the enabled:false gate (no fetch)', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useAttendanceList({ status: 'PRESENT' }, { enabled: false }), {
      wrapper: wrapper(client),
    });
    expect(result.current.fetchStatus).toBe('idle');
    expect(getMock).not.toHaveBeenCalled();
  });

  it('forwards params + branch into the key when enabled', async () => {
    getMock.mockResolvedValue({ data: { items: [], meta: {} } });
    const client = makeClient();
    const params = { userId: 'u9', page: 2 };
    const { result } = renderHook(() => useAttendanceList(params, { enabled: true }), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/personnel/attendance', { params });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual([
      'personnel', 'attendance', 'history', params, 'b-2',
    ]);
  });
});

describe('useShiftTemplates / useWeeklySchedule / usePerformanceMetrics keys', () => {
  it('useShiftTemplates keys on branch', async () => {
    getMock.mockResolvedValue({ data: [] });
    const client = makeClient();
    const { result } = renderHook(() => useShiftTemplates(), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['personnel', 'shift-templates', 'b-2']);
  });

  it('useWeeklySchedule forwards weekStart param + key', async () => {
    getMock.mockResolvedValue({ data: { assignments: [], staff: [] } });
    const client = makeClient();
    const { result } = renderHook(() => useWeeklySchedule('2026-06-08'), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/personnel/schedule', { params: { weekStart: '2026-06-08' } });
    expect(client.getQueryCache().getAll()[0].queryKey).toEqual(['personnel', 'schedule', '2026-06-08', 'b-2']);
  });

  it('usePerformanceMetrics forwards filter params', async () => {
    getMock.mockResolvedValue({ data: [] });
    const client = makeClient();
    const { result } = renderHook(() => usePerformanceMetrics({ userId: 'u3' }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getMock).toHaveBeenCalledWith('/personnel/performance/metrics', { params: { userId: 'u3' } });
  });
});

describe('useClockIn', () => {
  it('POSTs the optional notes body and invalidates the attendance scope', async () => {
    postMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useClockIn(), { wrapper: wrapper(client) });
    result.current.mutate('late start');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(postMock).toHaveBeenCalledWith('/personnel/attendance/clock-in', { notes: 'late start' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['personnel', 'attendance'] });
  });
});

describe('useApproveSwap — invalidates swap-requests AND schedule', () => {
  it('PATCHes the approve endpoint and refreshes both the swap list and the roster', async () => {
    patchMock.mockResolvedValue({ data: {} });
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useApproveSwap(), { wrapper: wrapper(client) });
    result.current.mutate('swap-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(patchMock).toHaveBeenCalledWith('/personnel/shift-swap/swap-1/approve');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['personnel', 'swap-requests'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['personnel', 'schedule'] });
  });
});
