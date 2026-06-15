import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useKioskMode } from './useKioskMode';

/**
 * useKioskMode persists the on/off choice in localStorage ('kds-kiosk') and
 * drives the Fullscreen API on a passed element ref. We stub the Fullscreen
 * API on a fake element + document so enabling requests fullscreen and
 * disabling exits, with both guarded against unsupported browsers.
 */

function makeFakeEl(): HTMLElement {
  const el = {
    requestFullscreen: vi.fn(() => Promise.resolve()),
  };
  return el as unknown as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  // Reset fullscreen state on the (jsdom) document.
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    writable: true,
    value: null,
  });
  (document as any).exitFullscreen = vi.fn(() => Promise.resolve());
});

describe('useKioskMode', () => {
  it('defaults to off and reads persisted state from localStorage', () => {
    const { result, rerender } = renderHook(() => useKioskMode());
    expect(result.current.kiosk).toBe(false);

    localStorage.setItem('kds-kiosk', 'true');
    const { result: result2 } = renderHook(() => useKioskMode());
    expect(result2.current.kiosk).toBe(true);
    rerender();
  });

  it('toggle flips the flag and persists it', () => {
    const { result } = renderHook(() => useKioskMode());

    act(() => result.current.toggle());
    expect(result.current.kiosk).toBe(true);
    expect(localStorage.getItem('kds-kiosk')).toBe('true');

    act(() => result.current.toggle());
    expect(result.current.kiosk).toBe(false);
    expect(localStorage.getItem('kds-kiosk')).toBe('false');
  });

  it('requests fullscreen on the ref when enabling and exits when disabling', () => {
    const ref = createRef<HTMLElement>();
    (ref as any).current = makeFakeEl();

    const { result } = renderHook(() => useKioskMode(ref));

    act(() => result.current.toggle()); // enable
    expect((ref.current as any).requestFullscreen).toHaveBeenCalledTimes(1);

    // Simulate the browser now being in fullscreen, then disable.
    (document as any).fullscreenElement = ref.current;
    act(() => result.current.toggle()); // disable
    expect((document as any).exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the Fullscreen API is unsupported', () => {
    const ref = createRef<HTMLElement>();
    (ref as any).current = {} as HTMLElement; // no requestFullscreen

    const { result } = renderHook(() => useKioskMode(ref));
    expect(() => act(() => result.current.toggle())).not.toThrow();
    expect(result.current.kiosk).toBe(true);
  });
});
