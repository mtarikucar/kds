import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Specs for useKitchenSocket — the KDS live feed. The hardware/transport
 * seam is lib/socket; we hand the hook a fake socket whose `.on` captures
 * handlers so we can drive them and assert the resulting query
 * invalidations + toast notifications, plus the connect/disconnect state
 * machine and the cleanup contract (own listeners off + socket
 * disconnected). AudioContext is stubbed away so the sound path no-ops.
 */

const handlers: Record<string, (e?: any) => void> = {};
const fakeSocket = {
  on: vi.fn((event: string, cb: (e?: any) => void) => {
    handlers[event] = cb;
  }),
  off: vi.fn(),
};
const initializeSocket = vi.fn(() => fakeSocket);
const disconnectSocket = vi.fn();
vi.mock('../../lib/socket', () => ({
  initializeSocket: () => initializeSocket(),
  disconnectSocket: () => disconnectSocket(),
}));

const toastSuccess = vi.fn();
const toastInfo = vi.fn();
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    info: (...a: unknown[]) => toastInfo(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
  },
}));
vi.mock('../../i18n/config', () => ({
  default: { t: (k: string, opts?: any) => (opts ? `${k}:${JSON.stringify(opts)}` : k) },
}));

import { useKitchenSocket } from './useKitchenSocket';

function wrapper(client: QueryClient) {
  return ({ children }: any) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  // No AudioContext available → playNotificationSound silently no-ops.
  (window as any).AudioContext = undefined;
  (window as any).webkitAudioContext = undefined;
});

describe('useKitchenSocket — subscription + connection state', () => {
  it('wires the order:* events on the shared socket and starts disconnected', () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    expect(initializeSocket).toHaveBeenCalledTimes(1);
    expect(fakeSocket.on).toHaveBeenCalledWith('order:new', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('order:updated', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('order:status-changed', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('stock:low-alert', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('stock:expiry-alert', expect.any(Function));
    expect(result.current.isConnected).toBe(false);
  });

  it('flips isConnected on connect and back on disconnect', () => {
    const client = new QueryClient();
    const { result } = renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    act(() => handlers['connect']());
    expect(result.current.isConnected).toBe(true);

    act(() => handlers['disconnect']());
    expect(result.current.isConnected).toBe(false);
  });
});

describe('useKitchenSocket — event handlers', () => {
  it('order:new invalidates orders and shows the new-order toast with the order number', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:new']({ orderNumber: 'ORD-42' }));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('"orderNumber":"ORD-42"'),
      expect.objectContaining({ position: 'top-center' }),
    );
  });

  it('order:updated invalidates both the list and the per-order key + shows an info toast', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:updated']({ orderId: 'o-9', orderNumber: 'ORD-9' }));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders', 'o-9'] });
    expect(toastInfo).toHaveBeenCalled();
  });

  it('order:status-changed invalidates list + per-order key WITHOUT a toast (silent refresh)', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    act(() => handlers['order:status-changed']({ orderId: 'o-3' }));

    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['orders', 'o-3'] });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('stock:low-alert shows a warning toast with the item count', () => {
    const client = new QueryClient();
    renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    act(() => handlers['stock:low-alert']({ count: 3, items: [] }));

    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('kitchen:kitchen.lowStockAlert'),
      expect.objectContaining({ position: 'top-center' }),
    );
  });

  it('stock:expiry-alert shows a warning toast with the batch count', () => {
    const client = new QueryClient();
    renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    act(() => handlers['stock:expiry-alert']({ count: 2, batches: [] }));

    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringContaining('kitchen:kitchen.stockExpiryAlert'),
      expect.objectContaining({ position: 'top-center' }),
    );
  });
});

describe('useKitchenSocket — cleanup', () => {
  it('removes its own listeners and disconnects the socket on unmount', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useKitchenSocket(), { wrapper: wrapper(client) });

    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith('order:new', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('order:status-changed', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('stock:low-alert', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('stock:expiry-alert', expect.any(Function));
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});
