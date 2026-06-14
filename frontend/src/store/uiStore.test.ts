import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './uiStore';

/**
 * Behavior guard for the per-machine UI-preferences store — 171 lines, zero
 * prior coverage. It owns three independent persisted slices (sidebar/section
 * collapse, onboarding/tour progress, per-terminal printer ids) plus one
 * transient flag (posTourPreview). The load-bearing surfaces are: nested
 * immutable updates (each setter must touch only its own key without dropping
 * siblings), the toggle default-of-expanded semantics for sections, and the
 * persist `partialize` contract (which fields survive a re-read and that the
 * transient flag is excluded). Tests drive the REAL store via getState() and
 * read it back; the persistence assertions read the actual localStorage blob.
 */

// Snapshot of the store's documented initial values. Used to fully reset the
// persisted store between tests (jsdom localStorage is shared).
const INITIAL = {
  isSidebarCollapsed: false,
  collapsedSections: {},
  onboarding: { hasSeenWelcome: false, tourProgress: {}, skipAllTours: false },
  posTourPreview: false,
  defaultReceiptPrinterId: null,
  defaultKitchenPrinterId: null,
};

function readPersisted(): Record<string, unknown> {
  const raw = localStorage.getItem('ui-storage');
  return raw ? JSON.parse(raw).state : {};
}

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({ ...INITIAL });
    localStorage.clear();
  });

  describe('defaults', () => {
    it('starts with sidebar expanded, empty maps, fresh onboarding and no printers', () => {
      const s = useUiStore.getState();
      expect(s.isSidebarCollapsed).toBe(false);
      expect(s.collapsedSections).toEqual({});
      expect(s.onboarding).toEqual({
        hasSeenWelcome: false,
        tourProgress: {},
        skipAllTours: false,
      });
      expect(s.posTourPreview).toBe(false);
      expect(s.defaultReceiptPrinterId).toBeNull();
      expect(s.defaultKitchenPrinterId).toBeNull();
    });
  });

  describe('sidebar', () => {
    it('toggleSidebar flips the collapsed flag each call', () => {
      const { toggleSidebar } = useUiStore.getState();
      expect(useUiStore.getState().isSidebarCollapsed).toBe(false);
      toggleSidebar();
      expect(useUiStore.getState().isSidebarCollapsed).toBe(true);
      toggleSidebar();
      expect(useUiStore.getState().isSidebarCollapsed).toBe(false);
    });

    it('setSidebarCollapsed sets the flag explicitly', () => {
      useUiStore.getState().setSidebarCollapsed(true);
      expect(useUiStore.getState().isSidebarCollapsed).toBe(true);
      useUiStore.getState().setSidebarCollapsed(false);
      expect(useUiStore.getState().isSidebarCollapsed).toBe(false);
    });
  });

  describe('section collapse — default expanded semantics', () => {
    it('toggleSection on an untracked section treats it as expanded and collapses it', () => {
      // Default for an absent key is "expanded" (falsy), so the first toggle
      // must land on collapsed=true, not back to false.
      useUiStore.getState().toggleSection('orders');
      expect(useUiStore.getState().collapsedSections.orders).toBe(true);
    });

    it('toggleSection flips an already-tracked section back to expanded', () => {
      const { toggleSection } = useUiStore.getState();
      toggleSection('orders'); // -> true
      toggleSection('orders'); // -> false
      expect(useUiStore.getState().collapsedSections.orders).toBe(false);
    });

    it('toggleSection touches only the targeted section, preserving siblings', () => {
      const { setSectionCollapsed, toggleSection } = useUiStore.getState();
      setSectionCollapsed('menu', true);
      toggleSection('orders');
      const map = useUiStore.getState().collapsedSections;
      expect(map).toEqual({ menu: true, orders: true });
    });

    it('setSectionCollapsed sets a specific section without clobbering others', () => {
      const { setSectionCollapsed } = useUiStore.getState();
      setSectionCollapsed('menu', true);
      setSectionCollapsed('orders', false);
      expect(useUiStore.getState().collapsedSections).toEqual({
        menu: true,
        orders: false,
      });
    });
  });

  describe('onboarding — nested immutable updates', () => {
    it('setHasSeenWelcome flips only hasSeenWelcome, keeping tourProgress and skipAllTours', () => {
      const { updateTourProgress, setHasSeenWelcome } = useUiStore.getState();
      updateTourProgress('pos', 2, false);
      setHasSeenWelcome(true);
      const ob = useUiStore.getState().onboarding;
      expect(ob.hasSeenWelcome).toBe(true);
      expect(ob.skipAllTours).toBe(false);
      expect(ob.tourProgress.pos).toMatchObject({ lastStep: 2, completed: false });
    });

    it('updateTourProgress records lastStep and completed for an in-progress tour without a completedAt', () => {
      useUiStore.getState().updateTourProgress('pos', 3, false);
      const entry = useUiStore.getState().onboarding.tourProgress.pos;
      expect(entry.lastStep).toBe(3);
      expect(entry.completed).toBe(false);
      expect(entry.completedAt).toBeUndefined();
    });

    it('updateTourProgress stamps a completedAt ISO timestamp when the tour completes', () => {
      useUiStore.getState().updateTourProgress('pos', 5, true);
      const entry = useUiStore.getState().onboarding.tourProgress.pos;
      expect(entry.completed).toBe(true);
      expect(entry.lastStep).toBe(5);
      expect(typeof entry.completedAt).toBe('string');
      // Round-trips as a valid date.
      expect(Number.isNaN(Date.parse(entry.completedAt as string))).toBe(false);
    });

    it('updateTourProgress keeps progress for other tours', () => {
      const { updateTourProgress } = useUiStore.getState();
      updateTourProgress('pos', 2, false);
      updateTourProgress('menu', 1, false);
      const tp = useUiStore.getState().onboarding.tourProgress;
      expect(Object.keys(tp).sort()).toEqual(['menu', 'pos']);
      expect(tp.pos.lastStep).toBe(2);
      expect(tp.menu.lastStep).toBe(1);
    });

    it('resetTour deletes only the targeted tour entry', () => {
      const { updateTourProgress, resetTour } = useUiStore.getState();
      updateTourProgress('pos', 2, true);
      updateTourProgress('menu', 1, false);
      resetTour('pos');
      const tp = useUiStore.getState().onboarding.tourProgress;
      expect(tp.pos).toBeUndefined();
      expect(tp.menu).toBeDefined();
    });

    it('resetTour is a no-op for an unknown tour id', () => {
      const { updateTourProgress, resetTour } = useUiStore.getState();
      updateTourProgress('pos', 2, false);
      resetTour('does-not-exist');
      expect(useUiStore.getState().onboarding.tourProgress.pos).toBeDefined();
    });

    it('setSkipAllTours flips only skipAllTours', () => {
      const { setHasSeenWelcome, setSkipAllTours } = useUiStore.getState();
      setHasSeenWelcome(true);
      setSkipAllTours(true);
      const ob = useUiStore.getState().onboarding;
      expect(ob.skipAllTours).toBe(true);
      expect(ob.hasSeenWelcome).toBe(true);
    });

    it('resetAllOnboarding restores the whole onboarding slice to its initial state', () => {
      const { setHasSeenWelcome, updateTourProgress, setSkipAllTours, resetAllOnboarding } =
        useUiStore.getState();
      setHasSeenWelcome(true);
      updateTourProgress('pos', 4, true);
      setSkipAllTours(true);
      resetAllOnboarding();
      expect(useUiStore.getState().onboarding).toEqual({
        hasSeenWelcome: false,
        tourProgress: {},
        skipAllTours: false,
      });
    });
  });

  describe('printer preferences', () => {
    it('setDefaultReceiptPrinterId and setDefaultKitchenPrinterId set independent ids', () => {
      const { setDefaultReceiptPrinterId, setDefaultKitchenPrinterId } = useUiStore.getState();
      setDefaultReceiptPrinterId('printer-r');
      setDefaultKitchenPrinterId('printer-k');
      const s = useUiStore.getState();
      expect(s.defaultReceiptPrinterId).toBe('printer-r');
      expect(s.defaultKitchenPrinterId).toBe('printer-k');
    });

    it('accepts clearing a printer back to null', () => {
      const { setDefaultReceiptPrinterId } = useUiStore.getState();
      setDefaultReceiptPrinterId('printer-r');
      setDefaultReceiptPrinterId(null);
      expect(useUiStore.getState().defaultReceiptPrinterId).toBeNull();
    });
  });

  describe('posTourPreview — transient flag', () => {
    it('setPosTourPreview toggles the in-memory flag', () => {
      const { setPosTourPreview } = useUiStore.getState();
      setPosTourPreview(true);
      expect(useUiStore.getState().posTourPreview).toBe(true);
      setPosTourPreview(false);
      expect(useUiStore.getState().posTourPreview).toBe(false);
    });
  });

  describe('persistence — partialize contract', () => {
    it('persists sidebar, sections, onboarding and printer ids to localStorage', () => {
      const s = useUiStore.getState();
      s.setSidebarCollapsed(true);
      s.setSectionCollapsed('orders', true);
      s.setHasSeenWelcome(true);
      s.setDefaultReceiptPrinterId('printer-r');
      s.setDefaultKitchenPrinterId('printer-k');

      const persisted = readPersisted();
      expect(persisted.isSidebarCollapsed).toBe(true);
      expect(persisted.collapsedSections).toEqual({ orders: true });
      expect(persisted.onboarding).toMatchObject({ hasSeenWelcome: true });
      expect(persisted.defaultReceiptPrinterId).toBe('printer-r');
      expect(persisted.defaultKitchenPrinterId).toBe('printer-k');
    });

    it('excludes the transient posTourPreview flag from the persisted blob', () => {
      useUiStore.getState().setPosTourPreview(true);
      // Persist a sibling field so the blob is written regardless.
      useUiStore.getState().setSidebarCollapsed(true);
      const persisted = readPersisted();
      expect('posTourPreview' in persisted).toBe(false);
    });

    it('persists exactly the five whitelisted keys and nothing else (no actions leak)', () => {
      useUiStore.getState().setSidebarCollapsed(true);
      const persisted = readPersisted();
      expect(Object.keys(persisted).sort()).toEqual([
        'collapsedSections',
        'defaultKitchenPrinterId',
        'defaultReceiptPrinterId',
        'isSidebarCollapsed',
        'onboarding',
      ]);
    });

    it('rehydrates persisted slices from a pre-existing localStorage blob', async () => {
      // Simulate a prior session by planting a known blob, then forcing the
      // persist middleware to re-read it. After rehydrate the live store must
      // reflect the planted values (proves the persist round-trip is wired).
      localStorage.setItem(
        'ui-storage',
        JSON.stringify({
          version: 0,
          state: {
            isSidebarCollapsed: true,
            collapsedSections: { menu: true },
            onboarding: {
              hasSeenWelcome: true,
              tourProgress: { pos: { completed: true, lastStep: 7, completedAt: '2026-01-01T00:00:00.000Z' } },
              skipAllTours: false,
            },
            defaultReceiptPrinterId: 'printer-r',
            defaultKitchenPrinterId: 'printer-k',
          },
        }),
      );

      await useUiStore.persist.rehydrate();

      const s = useUiStore.getState();
      expect(s.isSidebarCollapsed).toBe(true);
      expect(s.collapsedSections).toEqual({ menu: true });
      expect(s.onboarding.hasSeenWelcome).toBe(true);
      expect(s.onboarding.tourProgress.pos.lastStep).toBe(7);
      expect(s.onboarding.tourProgress.pos.completed).toBe(true);
      expect(s.defaultReceiptPrinterId).toBe('printer-r');
      expect(s.defaultKitchenPrinterId).toBe('printer-k');
    });
  });
});
