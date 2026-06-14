import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoUpdate } from './useAutoUpdate';

/**
 * useAutoUpdate is a thin orchestration layer over the Tauri updater plugin.
 * Outside of the desktop shell (`__TAURI__` absent on window) every action
 * must be an inert no-op — never touching the dynamic plugin imports. These
 * tests pin that web-environment guard and the initial state shape.
 */
describe('useAutoUpdate (web environment)', () => {
  beforeEach(() => {
    delete (window as any).__TAURI__;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with no update available and not downloading', () => {
    const { result } = renderHook(() => useAutoUpdate(false));
    expect(result.current.available).toBe(false);
    expect(result.current.downloading).toBe(false);
  });

  it('checkForUpdates is a no-op outside Tauri', async () => {
    const { result } = renderHook(() => useAutoUpdate(false));
    await act(async () => {
      await result.current.checkForUpdates();
    });
    expect(result.current.available).toBe(false);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('only available in desktop app'),
    );
  });

  it('downloadAndInstall is a no-op outside Tauri', async () => {
    const { result } = renderHook(() => useAutoUpdate(false));
    await act(async () => {
      await result.current.downloadAndInstall();
    });
    expect(result.current.downloading).toBe(false);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('only available in desktop app'),
    );
  });

  it('does not schedule a mount check when checkOnMount is false', () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    renderHook(() => useAutoUpdate(false));
    // No update timer scheduled in the web/no-mount-check path.
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });
});
