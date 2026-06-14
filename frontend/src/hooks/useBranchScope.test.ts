import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBranchScope } from './useBranchScope';
import { useBranchScopeStore } from '../store/branchScopeStore';

/**
 * useBranchScope is the read-only selector surface every branch-scoped
 * component reads to bake branchId into its query keys. The contract is:
 * it projects exactly { branchId, allowedBranchIds, isPinned } from the
 * store and re-renders on change, while NOT exposing the mutators. If the
 * projection drifts, components silently query the wrong branch.
 */
describe('useBranchScope', () => {
  beforeEach(() => {
    useBranchScopeStore.getState().clear();
    localStorage.clear();
  });

  it('projects the current store slice', () => {
    act(() =>
      useBranchScopeStore.setState({
        branchId: 'b-7',
        allowedBranchIds: ['b-7', 'b-8'],
        isPinned: true,
      }),
    );
    const { result } = renderHook(() => useBranchScope());
    expect(result.current).toEqual({
      branchId: 'b-7',
      allowedBranchIds: ['b-7', 'b-8'],
      isPinned: true,
    });
  });

  it('does not leak the store mutators (read-only surface)', () => {
    const { result } = renderHook(() => useBranchScope());
    expect(result.current).not.toHaveProperty('setBranchId');
    expect(result.current).not.toHaveProperty('hydrateFromUser');
    expect(result.current).not.toHaveProperty('clear');
    expect(Object.keys(result.current).sort()).toEqual([
      'allowedBranchIds',
      'branchId',
      'isPinned',
    ]);
  });

  it('re-renders with the new value when the active branch changes', () => {
    const { result } = renderHook(() => useBranchScope());
    expect(result.current.branchId).toBeNull();

    act(() => useBranchScopeStore.setState({ branchId: 'b-99' }));
    expect(result.current.branchId).toBe('b-99');
  });

  it('reflects an empty default scope after clear()', () => {
    act(() => useBranchScopeStore.setState({ branchId: 'b-1', isPinned: true }));
    const { result } = renderHook(() => useBranchScope());
    act(() => useBranchScopeStore.getState().clear());
    expect(result.current.branchId).toBeNull();
    expect(result.current.allowedBranchIds).toEqual([]);
    expect(result.current.isPinned).toBe(false);
  });
});
