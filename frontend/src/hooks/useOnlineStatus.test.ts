import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * useOnlineStatus combines navigator.onLine, the online/offline events, and a
 * real connectivity probe (HEAD /favicon.ico) behind a 30s interval. The
 * branches that matter: initial seed from navigator.onLine, flipping on the
 * offline event, and checkConnection mapping fetch ok/throw to true/false.
 * These guard the "you are offline" banner from firing on a healthy network.
 */
function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setOnLine(true);
});

describe('useOnlineStatus initial state', () => {
  it('seeds isOnline + lastOnline from navigator.onLine === true', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.wasOffline).toBe(false);
    expect(result.current.lastOnline).toBeInstanceOf(Date);
  });

  it('seeds isOnline=false and lastOnline=null when starting offline', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(false);
    expect(result.current.lastOnline).toBeNull();
  });
});

describe('useOnlineStatus event wiring', () => {
  it('flips isOnline to false on a window "offline" event', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(true);

    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event('offline'));
    });

    expect(result.current.isOnline).toBe(false);
  });

  it('flips isOnline back to true and refreshes lastOnline on "online"', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current.isOnline).toBe(false);
    expect(result.current.lastOnline).toBeNull();

    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event('online'));
    });

    expect(result.current.isOnline).toBe(true);
    expect(result.current.lastOnline).toBeInstanceOf(Date);
  });
});

describe('useOnlineStatus checkConnection probe', () => {
  it('returns true when the HEAD probe responds ok', async () => {
    setOnLine(true);
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true } as Response);
    const { result } = renderHook(() => useOnlineStatus());

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.checkConnection();
    });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/favicon.ico',
      expect.objectContaining({ method: 'HEAD', cache: 'no-store' }),
    );
  });

  it('returns false when the probe response is not ok', async () => {
    setOnLine(true);
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);
    const { result } = renderHook(() => useOnlineStatus());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.checkConnection();
    });
    expect(ok).toBe(false);
  });

  it('returns false (not throw) when the probe rejects', async () => {
    setOnLine(true);
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useOnlineStatus());
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.checkConnection();
    });
    expect(ok).toBe(false);
  });
});
