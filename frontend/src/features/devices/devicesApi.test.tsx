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
vi.mock('../../i18n/config', () => ({
  default: { t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k },
}));
vi.mock('../../lib/api-error', () => ({
  getApiErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import {
  deviceKeys,
  useListDevices,
  useCreateDeviceSlot,
  useRetireDevice,
  useListDeviceCommands,
  useEnqueueCommand,
} from './devicesApi';

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

describe('deviceKeys', () => {
  it('builds scoped keys', () => {
    expect(deviceKeys.all).toEqual(['devices']);
    expect(deviceKeys.list({ kind: 'kds_screen' })).toEqual([
      'devices',
      'list',
      { kind: 'kds_screen' },
    ]);
    expect(deviceKeys.commands('d1')).toEqual(['devices', 'd1', 'commands']);
  });
});

describe('devicesApi hooks', () => {
  it('useListDevices forwards filters as params', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListDevices({ status: 'online' }), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/devices', {
        params: { status: 'online' },
      }),
    );
  });

  it('useCreateDeviceSlot POSTs and invalidates the device list', async () => {
    h.post.mockResolvedValue({ data: { id: 'd1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateDeviceSlot(), { wrapper });
    await result.current.mutateAsync({ kind: 'kds_screen' });
    expect(h.post).toHaveBeenCalledWith('/v1/devices', { kind: 'kds_screen' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: deviceKeys.all });
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it('useCreateDeviceSlot toasts the fallback message on error', async () => {
    h.post.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCreateDeviceSlot(), { wrapper });
    await result.current
      .mutateAsync({ kind: 'kds_screen' })
      .catch(() => undefined);
    expect(h.toastError).toHaveBeenCalledWith('Failed to create slot');
  });

  it('useRetireDevice DELETEs by id', async () => {
    h.del.mockResolvedValue({ data: {} });
    const { result } = renderHook(() => useRetireDevice(), { wrapper });
    await result.current.mutateAsync('d9');
    expect(h.del).toHaveBeenCalledWith('/v1/devices/d9');
  });

  it('useListDeviceCommands is disabled without a deviceId', () => {
    const { result } = renderHook(() => useListDeviceCommands(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(h.get).not.toHaveBeenCalled();
  });

  it('useListDeviceCommands GETs commands with status + limit params', async () => {
    h.get.mockResolvedValue({ data: [] });
    renderHook(() => useListDeviceCommands('d1', 'queued'), { wrapper });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith('/v1/devices/d1/commands', {
        params: { status: 'queued', limit: 100 },
      }),
    );
  });

  it('useEnqueueCommand POSTs to the device commands endpoint and invalidates', async () => {
    h.post.mockResolvedValue({ data: { id: 'c1' } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useEnqueueCommand('d1'), { wrapper });
    await result.current.mutateAsync({ kind: 'reboot', payload: {} });
    expect(h.post).toHaveBeenCalledWith('/v1/devices/d1/commands', {
      kind: 'reboot',
      payload: {},
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: deviceKeys.commands('d1'),
    });
  });
});
