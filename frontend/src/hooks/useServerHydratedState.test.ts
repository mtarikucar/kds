import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useServerHydratedState } from './useServerHydratedState';

/**
 * Contract for the shared settings hydrate guard: query data hydrates local
 * state only while no local edit is pending. A refetch landing mid-edit
 * (skipWhile=true) is dropped — NOT queued — because the settling save
 * invalidates the query again and the follow-up refetch carries fresher
 * state. If this contract breaks, mid-flight refetches silently revert
 * toggles the user just changed (and the pending autosave then persists the
 * reverted snapshot).
 */

interface Snapshot {
  value: string;
}

function setup(initial: { data: Snapshot | undefined; skip: boolean }) {
  const hydrate = vi.fn();
  const view = renderHook(
    ({ data, skip }: { data: Snapshot | undefined; skip: boolean }) =>
      useServerHydratedState(data, hydrate, { skipWhile: skip }),
    { initialProps: initial }
  );
  return { hydrate, ...view };
}

describe('useServerHydratedState', () => {
  it('hydrates when data first arrives and the form is clean', () => {
    const { hydrate, rerender } = setup({ data: undefined, skip: false });
    expect(hydrate).not.toHaveBeenCalled();

    const server = { value: 'a' };
    rerender({ data: server, skip: false });
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate).toHaveBeenCalledWith(server);
  });

  it('skips hydrating while a save is pending / the form is dirty', () => {
    const first = { value: 'a' };
    const { hydrate, rerender } = setup({ data: first, skip: false });
    expect(hydrate).toHaveBeenCalledTimes(1);

    // User edits → dirty. The refetch triggered by an earlier save lands now.
    rerender({ data: first, skip: true });
    rerender({ data: { value: 'stale-refetch' }, skip: true });
    expect(hydrate).toHaveBeenCalledTimes(1); // mid-flight hydrate skipped
  });

  it('applies the next refetch after the edits settle', () => {
    const { hydrate, rerender } = setup({ data: { value: 'a' }, skip: false });
    expect(hydrate).toHaveBeenCalledTimes(1);

    const stale = { value: 'stale' };
    rerender({ data: stale, skip: true }); // skipped
    expect(hydrate).toHaveBeenCalledTimes(1);

    // Save settled (skip clears; react-query structural sharing keeps the
    // unchanged data as the SAME reference), then ITS invalidate delivers
    // fresh data.
    rerender({ data: stale, skip: false });
    const settled = { value: 'fresh' };
    rerender({ data: settled, skip: false });
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(hydrate).toHaveBeenLastCalledWith(settled);
  });

  it('does NOT replay a skipped snapshot just because the form became clean', () => {
    const first = { value: 'a' };
    const { hydrate, rerender } = setup({ data: first, skip: false });
    expect(hydrate).toHaveBeenCalledTimes(1);

    const stale = { value: 'stale' };
    rerender({ data: stale, skip: true }); // dropped
    rerender({ data: stale, skip: false }); // skip cleared, data unchanged
    // Replaying here would clobber the just-saved edits with a snapshot that
    // predates them; the post-save refetch is the one that must apply.
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('ignores null/undefined data entirely', () => {
    const { hydrate, rerender } = setup({ data: undefined, skip: false });
    rerender({ data: undefined, skip: false });
    expect(hydrate).not.toHaveBeenCalled();
  });
});
