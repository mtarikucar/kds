import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResponsive, BREAKPOINTS } from './useResponsive';

/**
 * useResponsive derives mobile/tablet/desktop bands from window.innerWidth
 * and re-derives them on a 'resize' event. The boundaries are load-bearing:
 * the whole responsive layout (md:hidden / lg:block) keys off these flags,
 * so an off-by-one at a breakpoint silently shows the wrong chrome. These
 * tests pin the exact band edges and the live resize subscription.
 */
function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
}

describe('useResponsive', () => {
  afterEach(() => {
    setWidth(1024);
  });

  it('classifies a phone width (< md) as mobile', () => {
    setWidth(500);
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isMobile).toBe(true);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.isDesktop).toBe(false);
    expect(result.current.screenSize).toBe('mobile');
    expect(result.current.width).toBe(500);
  });

  it('treats exactly md (768) as tablet, not mobile (inclusive lower edge)', () => {
    setWidth(BREAKPOINTS.md); // 768
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isMobile).toBe(false);
    expect(result.current.isTablet).toBe(true);
    expect(result.current.screenSize).toBe('tablet');
  });

  it('treats one below lg (1023) as tablet', () => {
    setWidth(BREAKPOINTS.lg - 1); // 1023
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isTablet).toBe(true);
    expect(result.current.isDesktop).toBe(false);
  });

  it('treats exactly lg (1024) as desktop (inclusive lower edge)', () => {
    setWidth(BREAKPOINTS.lg); // 1024
    const { result } = renderHook(() => useResponsive());
    expect(result.current.isDesktop).toBe(true);
    expect(result.current.isTablet).toBe(false);
    expect(result.current.screenSize).toBe('desktop');
  });

  it('re-derives the band when the window fires a resize event', () => {
    setWidth(1280);
    const { result } = renderHook(() => useResponsive());
    expect(result.current.screenSize).toBe('desktop');

    act(() => {
      setWidth(600);
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.width).toBe(600);
    expect(result.current.isMobile).toBe(true);
    expect(result.current.screenSize).toBe('mobile');
  });

  it('detaches the resize listener on unmount (no further updates)', () => {
    setWidth(1280);
    const { result, unmount } = renderHook(() => useResponsive());
    unmount();

    act(() => {
      setWidth(300);
      window.dispatchEvent(new Event('resize'));
    });

    // Width captured at unmount time must not change post-unmount.
    expect(result.current.width).toBe(1280);
  });
});
