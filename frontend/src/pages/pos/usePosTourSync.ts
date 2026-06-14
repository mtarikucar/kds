import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useUiStore } from '../../store/uiStore';
import type { Table } from '../../types';
import type { POSView } from './posTypes';

/**
 * Onboarding tour preview sync.
 *
 * While the POS onboarding tour is previewing steps that target the
 * menu-panel / order-cart anchors, force the page into the 'order' view
 * (takeaway shape — no selected table) so those anchors exist to point at.
 * When the preview ends, restore the view that was active before it started.
 *
 * The previous view is snapshotted into a ref so re-renders driven by the
 * view change itself don't loop. Extracted verbatim from POSPage; the effect
 * deliberately depends only on `posTourPreview` (the original carried an
 * exhaustive-deps disable for exactly this reason — it must NOT re-run when
 * `currentView` changes, or it would clobber user navigation mid-preview).
 */
export function usePosTourSync(
  currentView: POSView,
  setCurrentView: Dispatch<SetStateAction<POSView>>,
  setSelectedTable: Dispatch<SetStateAction<Table | null>>,
): void {
  const posTourPreview = useUiStore((s) => s.posTourPreview);
  const prevTourViewRef = useRef<POSView | null>(null);

  useEffect(() => {
    if (posTourPreview) {
      if (prevTourViewRef.current === null) {
        prevTourViewRef.current = currentView;
      }
      setSelectedTable(null);
      setCurrentView('order');
    } else if (prevTourViewRef.current !== null) {
      setCurrentView(prevTourViewRef.current);
      setSelectedTable(null);
      prevTourViewRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posTourPreview]);
}
