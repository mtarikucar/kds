import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { usePosTourSync } from './usePosTourSync';
import { useUiStore } from '../../store/uiStore';
import type { POSView } from './posTypes';
import type { Table } from '../../types';

beforeEach(() => {
  act(() => {
    useUiStore.setState({ posTourPreview: false });
  });
});

/**
 * Harness that wires usePosTourSync to real useState-backed view/table state,
 * matching how POSPage holds them, so we observe the real effect outcome
 * (the forced 'order' view and the restore) rather than mocking setters.
 */
function useHarness(initialView: POSView) {
  const [currentView, setCurrentView] = useState<POSView>(initialView);
  const [selectedTable, setSelectedTable] = useState<Table | null>({
    id: 't-1',
  } as Table);
  usePosTourSync(currentView, setCurrentView, setSelectedTable);
  return { currentView, selectedTable, setCurrentView };
}

describe('usePosTourSync', () => {
  it('does nothing while preview is off and was never on', () => {
    const { result } = renderHook(() => useHarness('table-selection'));
    expect(result.current.currentView).toBe('table-selection');
    expect(result.current.selectedTable).not.toBeNull();
  });

  it('forces order view and clears the table when preview turns on', () => {
    const { result } = renderHook(() => useHarness('table-selection'));

    act(() => {
      useUiStore.setState({ posTourPreview: true });
    });

    expect(result.current.currentView).toBe('order');
    expect(result.current.selectedTable).toBeNull();
  });

  it('restores the pre-preview view when preview turns off', () => {
    const { result } = renderHook(() => useHarness('table-selection'));

    act(() => {
      useUiStore.setState({ posTourPreview: true });
    });
    expect(result.current.currentView).toBe('order');

    act(() => {
      useUiStore.setState({ posTourPreview: false });
    });
    // restored to the view captured before the preview started
    expect(result.current.currentView).toBe('table-selection');
    expect(result.current.selectedTable).toBeNull();
  });

  it('snapshots the view at preview-start, not the latest navigation', () => {
    const { result } = renderHook(() => useHarness('order'));

    // Preview starts while already on 'order'
    act(() => {
      useUiStore.setState({ posTourPreview: true });
    });
    expect(result.current.currentView).toBe('order');

    // Turning preview off restores the snapshot ('order')
    act(() => {
      useUiStore.setState({ posTourPreview: false });
    });
    expect(result.current.currentView).toBe('order');
  });
});
