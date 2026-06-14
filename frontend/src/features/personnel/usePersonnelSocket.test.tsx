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

let socketToReturn: any = fakeSocket;
const getSocket = vi.fn(() => socketToReturn);
const initializeSocket = vi.fn(() => fakeSocket);

vi.mock('../../lib/socket', () => ({
  getSocket: () => getSocket(),
  initializeSocket: () => initializeSocket(),
}));

function wrapper(client: QueryClient) {
  return ({ children }: any) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  socketToReturn = fakeSocket;
});

describe('usePersonnelSocket', () => {
  it('subscribes to the attendance and swap-request events on the shared socket', () => {
    const client = new QueryClient();
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });

    expect(fakeSocket.on).toHaveBeenCalledWith('personnel:attendance-update', expect.any(Function));
    expect(fakeSocket.on).toHaveBeenCalledWith('personnel:swap-request-update', expect.any(Function));
  });

  it('initializes the socket when none is connected yet', () => {
    socketToReturn = null; // getSocket() returns null → fall back to initializeSocket()
    const client = new QueryClient();
    renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });
    expect(initializeSocket).toHaveBeenCalledTimes(1);
  });

  it('does nothing (no listeners) when no socket can be obtained', () => {
    socketToReturn = null;
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

  it('removes its own listeners on unmount but never disconnects the shared socket', () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => usePersonnelSocket(), { wrapper: wrapper(client) });

    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith('personnel:attendance-update', expect.any(Function));
    expect(fakeSocket.off).toHaveBeenCalledWith('personnel:swap-request-update', expect.any(Function));
    // Shared socket must stay alive for other features.
    expect(fakeSocket.disconnect).not.toHaveBeenCalled();
  });
});
