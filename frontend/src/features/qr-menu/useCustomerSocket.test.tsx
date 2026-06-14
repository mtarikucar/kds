import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Specs for useCustomerSocket — the customer-facing QR socket. The
 * transport seam is socket.io-client's `io()`; we mock it to return a
 * controllable fake. We assert: the session-auth connection config, that
 * each customer:* event forwards to the matching callback, the empty
 * sessionId early-return (no connection), the connected-state machine,
 * and the disconnect-on-unmount cleanup.
 */

const handlers: Record<string, (e?: any) => void> = {};
const fakeSocket = {
  id: 'sock-1',
  on: vi.fn((event: string, cb: (e?: any) => void) => {
    handlers[event] = cb;
  }),
  off: vi.fn(),
  disconnect: vi.fn(),
};
const io = vi.fn((..._a: unknown[]) => fakeSocket);
vi.mock('socket.io-client', () => ({ io: (...a: unknown[]) => io(...a), Socket: class {} }));

import { useCustomerSocket } from './useCustomerSocket';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
});

describe('useCustomerSocket — connection', () => {
  it('does NOT connect when sessionId is empty', () => {
    renderHook(() => useCustomerSocket({ sessionId: '' }));
    expect(io).not.toHaveBeenCalled();
  });

  it('connects to the /kds namespace with the session in both auth and query', () => {
    renderHook(() => useCustomerSocket({ sessionId: 's-9' }));
    expect(io).toHaveBeenCalledTimes(1);
    const [url, opts] = io.mock.calls[0] as [string, any];
    expect(url).toContain('/kds');
    expect(opts.auth).toEqual({ sessionId: 's-9' });
    expect(opts.query).toEqual({ sessionId: 's-9' });
  });

  it('reflects connect/disconnect/connect_error in isConnected', () => {
    const { result } = renderHook(() => useCustomerSocket({ sessionId: 's-9' }));
    expect(result.current.isConnected).toBe(false);

    act(() => handlers['connect']());
    expect(result.current.isConnected).toBe(true);

    act(() => handlers['disconnect']());
    expect(result.current.isConnected).toBe(false);

    act(() => handlers['connect']());
    act(() => handlers['connect_error'](new Error('boom')));
    expect(result.current.isConnected).toBe(false);
  });
});

describe('useCustomerSocket — callback forwarding', () => {
  it('forwards each customer:* event to its callback with the payload', () => {
    const onOrderCreated = vi.fn();
    const onOrderApproved = vi.fn();
    const onOrderStatusUpdated = vi.fn();
    const onLoyaltyEarned = vi.fn();
    renderHook(() =>
      useCustomerSocket({
        sessionId: 's-9',
        onOrderCreated,
        onOrderApproved,
        onOrderStatusUpdated,
        onLoyaltyEarned,
      }),
    );

    act(() => handlers['customer:order-created']({ id: 'o1' }));
    act(() => handlers['customer:order-approved']({ id: 'o2' }));
    act(() => handlers['customer:order-status-updated']({ id: 'o3', status: 'READY' }));
    act(() => handlers['customer:loyalty-earned']({ points: 10 }));

    expect(onOrderCreated).toHaveBeenCalledWith({ id: 'o1' });
    expect(onOrderApproved).toHaveBeenCalledWith({ id: 'o2' });
    expect(onOrderStatusUpdated).toHaveBeenCalledWith({ id: 'o3', status: 'READY' });
    expect(onLoyaltyEarned).toHaveBeenCalledWith({ points: 10 });
  });

  it('does not throw when an event fires with no callback supplied', () => {
    renderHook(() => useCustomerSocket({ sessionId: 's-9' }));
    expect(() => act(() => handlers['customer:order-created']({ id: 'x' }))).not.toThrow();
  });
});

describe('useCustomerSocket — cleanup', () => {
  it('removes listeners and disconnects on unmount', () => {
    const { unmount } = renderHook(() => useCustomerSocket({ sessionId: 's-9' }));
    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith('customer:order-created', expect.any(Function));
    expect(fakeSocket.disconnect).toHaveBeenCalledTimes(1);
  });
});
