import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePersonnelSocket } from './usePersonnelSocket';

// --- mock the shared socket layer --------------------------------------

const handlers: Record<string, () => void> = {};
const fakeSocket = {
  on: vi.fn((event: string, cb: () => void) => {
    handlers[event] = cb;
  }),
  off: vi.fn(),
  disconnect: vi.fn(),
};

const initializeSocket = vi.fn(() => fakeSocket as any);
const disconnectSocket = vi.fn();

vi.mock('../../lib/socket', () => ({
  initializeSocket: () => initializeSocket(),
  disconnectSocket: () => disconnectSocket(),
}));

function wrapper(client: QueryClient) {
  return ({ children }: any) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  initializeSocket.mockReturnValue(fakeSocket as any);
});

describe('usePersonnelSocket', () => {
  it('subscribes to the attendance and swap-request events on the shared socket', () => {
    const client = new QueryClient();
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });

    expect(fakeSocket.on).toHaveBeenCalledWith('personnel:attendance-update', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('personnel:swap-request-update', expect.any(Function));
  });

  it('takes a socket refcount via initializeSocket on mount', () => {
    const client = new QueryClient();
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });
    // Symmetric with usePosSocket/useKitchenSocket — always initializeSocket()
    // (which refcounts), never getSocket() without a matching release.
    expect(initializeSocket).toHaveBeenCalledTimes(1);
  });

  it('does nothing (no listeners) when no socket can be obtained', () => {
    initializeSocket.mockReturnValueOnce(null as any);
    const client = new QueryClient();
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });
    // No socket → the early return means no .on() wiring on the fake socket.
    expect(fakeSocket.on).not.toHaveBeenCalled();
  });

  it('invalidates the attendance query when an attendance-update event fires', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });

    handlers['personnel:attendance-update']();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['personnel', 'attendance'] });
  });

  it('invalidates both swap-requests and schedule queries on a swap-request-update', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });

    handlers['personnel:swap-request-update']();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['personnel', 'swap-requests'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['personnel', 'schedule'] });
  });

  it('removes its listeners and releases its socket refcount on unmount', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });

    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith('personnel:attendance-update', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('personnel:swap-request-update', expect.any(Function));
    // Releases the refcount it took on mount (disconnectSocket only actually
    // closes the socket when the LAST consumer unmounts — that gating lives in
    // lib/socket, mocked here). This balances the initializeSocket() +1 that
    // previously leaked.
    expect(disconnectSocket).toHaveBeenCalledTimes(1);
  });
});
