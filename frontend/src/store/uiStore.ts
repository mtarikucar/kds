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

  // Onboarding state
  onboarding: OnboardingState;
  setHasSeenWelcome: (seen: boolean) => void;
  updateTourProgress: (tourId: string, step: number, completed: boolean) => void;
  resetTour: (tourId: string) => void;
  setSkipAllTours: (skip: boolean) => void;
  resetAllOnboarding: () => void;
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
    }),
    {
      name: 'ui-storage',
    }
  )
);
