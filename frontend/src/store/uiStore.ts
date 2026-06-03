import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TourProgress {
  completed: boolean;
  lastStep: number;
  completedAt?: string;
}

interface OnboardingState {
  hasSeenWelcome: boolean;
  tourProgress: Record<string, TourProgress>;
  skipAllTours: boolean;
}

interface UiState {
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  // v2.8.88 — sidebar section collapse state. Per section id; default
  // is "expanded". Rail mode (isSidebarCollapsed=true) hides section
  // headers entirely regardless of this map.
  collapsedSections: Record<string, boolean>;
  toggleSection: (sectionId: string) => void;
  setSectionCollapsed: (sectionId: string, collapsed: boolean) => void;

  // v3.0.0 — branch scope lives in branchScopeStore.ts. The legacy
  // uiStore.activeBranchId field was removed to keep state slices
  // single-purpose (cross-store side effects were the audit's
  // High finding #9). useBranchScope() is the read hook.

  // Onboarding state
  onboarding: OnboardingState;
  setHasSeenWelcome: (seen: boolean) => void;
  updateTourProgress: (tourId: string, step: number, completed: boolean) => void;
  resetTour: (tourId: string) => void;
  setSkipAllTours: (skip: boolean) => void;
  resetAllOnboarding: () => void;

  // Transient flag set by the onboarding tour to force POSPage into
  // its 'order' view (menu-panel + order-cart visible) while those
  // tour steps are active. Not persisted — reset on refresh.
  posTourPreview: boolean;
  setPosTourPreview: (on: boolean) => void;

  // Per-machine hardware preferences. Persisted in localStorage so each
  // POS terminal remembers its own paired printer / drawer / kitchen
  // printer; not synced to the backend (each terminal has its own
  // hardware).
  defaultReceiptPrinterId: string | null;
  defaultKitchenPrinterId: string | null;
  setDefaultReceiptPrinterId: (id: string | null) => void;
  setDefaultKitchenPrinterId: (id: string | null) => void;
}

const initialOnboardingState: OnboardingState = {
  hasSeenWelcome: false,
  tourProgress: {},
  skipAllTours: false,
};

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      isSidebarCollapsed: false,

      toggleSidebar: () => {
        set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed }));
      },

      setSidebarCollapsed: (collapsed: boolean) => {
        set({ isSidebarCollapsed: collapsed });
      },

      // v2.8.88 — section collapse
      collapsedSections: {},
      toggleSection: (sectionId: string) => {
        set((state) => ({
          collapsedSections: {
            ...state.collapsedSections,
            [sectionId]: !state.collapsedSections[sectionId],
          },
        }));
      },
      setSectionCollapsed: (sectionId: string, collapsed: boolean) => {
        set((state) => ({
          collapsedSections: { ...state.collapsedSections, [sectionId]: collapsed },
        }));
      },

      // Onboarding state
      onboarding: initialOnboardingState,

      setHasSeenWelcome: (seen: boolean) => {
        set((state) => ({
          onboarding: {
            ...state.onboarding,
            hasSeenWelcome: seen,
          },
        }));
      },

      updateTourProgress: (tourId: string, step: number, completed: boolean) => {
        set((state) => ({
          onboarding: {
            ...state.onboarding,
            tourProgress: {
              ...state.onboarding.tourProgress,
              [tourId]: {
                completed,
                lastStep: step,
                completedAt: completed ? new Date().toISOString() : undefined,
              },
            },
          },
        }));
      },

      resetTour: (tourId: string) => {
        set((state) => {
          const { [tourId]: _, ...rest } = state.onboarding.tourProgress;
          return {
            onboarding: {
              ...state.onboarding,
              tourProgress: rest,
            },
          };
        });
      },

      setSkipAllTours: (skip: boolean) => {
        set((state) => ({
          onboarding: {
            ...state.onboarding,
            skipAllTours: skip,
          },
        }));
      },

      resetAllOnboarding: () => {
        set({ onboarding: initialOnboardingState });
      },

      posTourPreview: false,
      setPosTourPreview: (on: boolean) => {
        set({ posTourPreview: on });
      },

      // Per-machine hardware preferences
      defaultReceiptPrinterId: null,
      defaultKitchenPrinterId: null,
      setDefaultReceiptPrinterId: (id) => {
        set({ defaultReceiptPrinterId: id });
      },
      setDefaultKitchenPrinterId: (id) => {
        set({ defaultKitchenPrinterId: id });
      },
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        isSidebarCollapsed: state.isSidebarCollapsed,
        collapsedSections: state.collapsedSections,
        onboarding: state.onboarding,
        defaultReceiptPrinterId: state.defaultReceiptPrinterId,
        defaultKitchenPrinterId: state.defaultKitchenPrinterId,
      }),
    }
  )
);
