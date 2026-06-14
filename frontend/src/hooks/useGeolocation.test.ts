import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGeolocation } from './useGeolocation';

/**
 * useGeolocation wraps the browser Geolocation API into a stateful hook with
 * a hand-rolled error->message+permissionStatus mapping (Turkish copy). The
 * branch table (PERMISSION_DENIED / POSITION_UNAVAILABLE / TIMEOUT / default)
 * and the "no navigator.geolocation" early-out are the real logic worth
 * pinning — a regression here silently mislabels why a location grab failed.
 */

// Mirrors the numeric codes the browser uses on GeolocationPositionError.
const ERR = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };

function installGeolocation(impl: {
  getCurrentPosition?: (success: any, error: any, opts: any) => void;
}) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: impl.getCurrentPosition ?? vi.fn() },
  });
}

function removeGeolocation() {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: undefined,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGeolocation getCurrentPosition', () => {
  it('starts with a clean prompt state and no coordinates', () => {
    installGeolocation({});
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.latitude).toBeNull();
    expect(result.current.longitude).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.permissionStatus).toBe('prompt');
  });

  it('resolves with coords and marks permission granted on success', async () => {
    installGeolocation({
      getCurrentPosition: (success) =>
        success({ coords: { latitude: 41.01, longitude: 28.97 } }),
    });
    const { result } = renderHook(() => useGeolocation());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.getCurrentPosition();
    });

    expect(returned).toEqual({ latitude: 41.01, longitude: 28.97 });
    expect(result.current.latitude).toBe(41.01);
    expect(result.current.longitude).toBe(28.97);
    expect(result.current.permissionStatus).toBe('granted');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('short-circuits to "unavailable" when navigator.geolocation is missing', async () => {
    removeGeolocation();
    const { result } = renderHook(() => useGeolocation());

    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.getCurrentPosition();
    });

    expect(returned).toBeNull();
    expect(result.current.permissionStatus).toBe('unavailable');
    expect(result.current.error).toMatch(/not supported/i);
  });

  it('maps PERMISSION_DENIED to denied + the izin-reddedildi message', async () => {
    installGeolocation({
      getCurrentPosition: (_s, error) =>
        error({ code: ERR.PERMISSION_DENIED, ...ERR }),
    });
    const { result } = renderHook(() => useGeolocation());

    let returned: unknown = 'sentinel';
    await act(async () => {
      returned = await result.current.getCurrentPosition();
    });

    expect(returned).toBeNull();
    expect(result.current.permissionStatus).toBe('denied');
    expect(result.current.error).toContain('Konum izni reddedildi');
    expect(result.current.latitude).toBeNull();
  });

  it('maps POSITION_UNAVAILABLE to unavailable + GPS message', async () => {
    installGeolocation({
      getCurrentPosition: (_s, error) =>
        error({ code: ERR.POSITION_UNAVAILABLE, ...ERR }),
    });
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.getCurrentPosition();
    });
    expect(result.current.permissionStatus).toBe('unavailable');
    expect(result.current.error).toContain("GPS'inizi açın");
  });

  it('maps TIMEOUT back to prompt + zaman aşımı message', async () => {
    installGeolocation({
      getCurrentPosition: (_s, error) => error({ code: ERR.TIMEOUT, ...ERR }),
    });
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.getCurrentPosition();
    });
    expect(result.current.permissionStatus).toBe('prompt');
    expect(result.current.error).toContain('zaman aşımına');
  });

  it('falls through to the generic message for an unknown error code', async () => {
    installGeolocation({
      getCurrentPosition: (_s, error) => error({ code: 99, ...ERR }),
    });
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.getCurrentPosition();
    });
    expect(result.current.permissionStatus).toBe('prompt');
    expect(result.current.error).toBe('Konum alınırken bir hata oluştu.');
  });

  it('forwards the merged option set to the browser API', async () => {
    const spy = vi.fn((success: any) =>
      success({ coords: { latitude: 1, longitude: 2 } }),
    );
    installGeolocation({ getCurrentPosition: spy });
    const { result } = renderHook(() =>
      useGeolocation({ timeout: 5000 }),
    );
    await act(async () => {
      await result.current.getCurrentPosition();
    });
    // defaults merged with the override: enableHighAccuracy default kept,
    // timeout overridden, maximumAge default kept.
    expect(spy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
    );
  });
});

describe('useGeolocation checkPermission / clearError', () => {
  it('returns null and stays silent when navigator.permissions is missing', async () => {
    installGeolocation({});
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useGeolocation());
    let res: unknown = 'sentinel';
    await act(async () => {
      res = await result.current.checkPermission();
    });
    expect(res).toBeNull();
    expect(result.current.permissionStatus).toBe('prompt');
  });

  it('reflects the Permissions API state into permissionStatus', async () => {
    installGeolocation({});
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) },
    });
    const { result } = renderHook(() => useGeolocation());
    let res: unknown;
    await act(async () => {
      res = await result.current.checkPermission();
    });
    expect(res).toBe('granted');
    expect(result.current.permissionStatus).toBe('granted');
  });

  it('clearError wipes a previously-set error without touching coords', async () => {
    installGeolocation({
      getCurrentPosition: (_s, error) =>
        error({ code: ERR.PERMISSION_DENIED, ...ERR }),
    });
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.getCurrentPosition();
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
