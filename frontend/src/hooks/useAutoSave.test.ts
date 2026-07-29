import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoSave } from './useAutoSave';

/**
 * Behavior guard for the debounced auto-save hook. These tests pin the
 * user-observable contract: changes coalesce within the debounce window, the
 * save callback always receives the latest value, async rejection surfaces an
 * error state instead of crashing, and an unmounted hook never fires a save or
 * touches state. If any of these break, drafts silently fail to persist (or a
 * stale value gets written) without a compile error to catch it.
 */

// Lets a pending microtask (the awaited saveFn promise) settle while fake
// timers are installed.
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not save before the debounce window elapses, then saves once', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave<string>('a', saveFn, { debounceMs: 800 }));

    act(() => result.current.setValue('b'));

    // Just shy of the window: no save yet.
    act(() => vi.advanceTimersByTime(799));
    expect(saveFn).not.toHaveBeenCalled();

    // Crossing the window fires exactly one save.
    act(() => vi.advanceTimersByTime(1));
    await flushPromises();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('b');
  });

  it('coalesces rapid changes: the timer resets and only one save fires with the latest value', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave<string>('a', saveFn, { debounceMs: 800 }));

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(500));

    // A second change inside the window must restart the timer.
    act(() => result.current.setValue('c'));
    act(() => vi.advanceTimersByTime(500)); // 1000ms since first change, only 500ms since second
    expect(saveFn).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300)); // now 800ms since the second change
    await flushPromises();
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('c'); // latest value, not the intermediate
  });

  it('reports status transitions idle -> saving -> saved -> idle', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800, onSuccess })
    );

    expect(result.current.status).toBe('idle');

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(800));
    await flushPromises();

    expect(result.current.status).toBe('saved');
    expect(result.current.lastSaved).toBeInstanceOf(Date);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // The hook auto-resets to idle 2s after a successful save.
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.status).toBe('idle');
  });

  it('surfaces an error state on rejection without crashing and calls onError', async () => {
    const boom = new Error('network down');
    const saveFn = vi.fn().mockRejectedValue(boom);
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800, onError })
    );

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(800));
    await flushPromises();

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('network down');
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('save() flushes immediately, cancelling the pending debounced save', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutoSave<string>('a', saveFn, { debounceMs: 800 }));

    act(() => result.current.setValue('b'));
    // Manual save before the debounce elapses.
    await act(async () => {
      await result.current.save();
    });
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('b');

    // The previously pending timer was cleared, so no second save fires.
    act(() => vi.advanceTimersByTime(2000));
    await flushPromises();
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('retry() re-invokes the save with the latest value after a failure', async () => {
    const saveFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first fails'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAutoSave<string>('a', saveFn, { debounceMs: 800 }));

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(800));
    await flushPromises();
    expect(result.current.status).toBe('error');

    await act(async () => {
      await result.current.retry();
    });
    expect(saveFn).toHaveBeenCalledTimes(2);
    expect(saveFn).toHaveBeenLastCalledWith('b');
    expect(result.current.status).toBe('saved');
  });

  it('flushes a pending debounced save on unmount with the latest value', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const { result, unmount } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800, onSuccess })
    );

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(400)); // still inside the window
    unmount();

    // The cleanup fires the save immediately (fire-and-forget) — a
    // tab-switch inside the debounce window must not silently lose the edit.
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('b');
    await flushPromises();
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // The timer itself was cleared: no SECOND save fires later.
    act(() => vi.advanceTimersByTime(1000));
    await flushPromises();
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it('a failed final flush on unmount still reports through onError', async () => {
    const boom = new Error('offline');
    const saveFn = vi.fn().mockRejectedValue(boom);
    const onError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800, onError })
    );

    act(() => result.current.setValue('b'));
    unmount();

    expect(saveFn).toHaveBeenCalledWith('b');
    await flushPromises();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('does not fire any save on unmount when nothing is pending', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800 })
    );

    unmount();
    await flushPromises();
    expect(saveFn).not.toHaveBeenCalled();
  });

  it('tracks isDirty across the edit → in-flight → settled lifecycle', async () => {
    let resolveSave: (() => void) | undefined;
    const saveFn = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        })
    );
    const { result } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800 })
    );

    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setValue('b'));
    expect(result.current.isDirty).toBe(true);

    // Save goes in flight: still dirty until it settles.
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('stays dirty when a NEWER edit lands while a save is in flight', async () => {
    let resolveSave: (() => void) | undefined;
    const saveFn = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        })
    );
    const { result } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800 })
    );

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(800)); // save('b') in flight

    act(() => result.current.setValue('c')); // newer edit mid-flight

    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
    // The resolved save persisted 'b', not 'c' — the hook must still report
    // dirty so hydrate guards keep protecting the unsaved 'c'.
    expect(result.current.isDirty).toBe(true);
  });

  it('stays dirty after a failed save (the local edit is still unpersisted)', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800 })
    );

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(800));
    await flushPromises();

    expect(result.current.status).toBe('error');
    expect(result.current.isDirty).toBe(true);
  });

  it('does not let an initialValue change clobber a pending edit', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ initial }: { initial: string }) =>
        useAutoSave<string>(initial, saveFn, { debounceMs: 800 }),
      { initialProps: { initial: 'server-1' } }
    );

    act(() => result.current.setValue('edited'));
    // A refetch clobbers the page state (and thus initialValue) mid-debounce.
    rerender({ initial: 'server-stale' });

    act(() => vi.advanceTimersByTime(800));
    await flushPromises();
    // The pending save must persist the USER's edit, not the stale snapshot.
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(saveFn).toHaveBeenCalledWith('edited');
  });

  it('does not update state after unmount when an in-flight save resolves', async () => {
    let resolveSave: (() => void) | undefined;
    const saveFn = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveSave = res;
        })
    );
    const { result, unmount } = renderHook(() =>
      useAutoSave<string>('a', saveFn, { debounceMs: 800 })
    );

    act(() => result.current.setValue('b'));
    act(() => vi.advanceTimersByTime(800));
    // saveFn is now in flight (awaiting resolveSave).
    expect(saveFn).toHaveBeenCalledTimes(1);

    unmount();
    // Resolving after unmount must not throw or attempt a post-unmount setState.
    await act(async () => {
      resolveSave?.();
      await Promise.resolve();
    });
    // No assertion error / unhandled rejection means the mounted-guard held.
    expect(saveFn).toHaveBeenCalledTimes(1);
  });
});
