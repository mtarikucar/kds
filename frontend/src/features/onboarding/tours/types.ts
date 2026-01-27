import { Step, Placement } from 'react-joyride';

export interface TourStep extends Step {
  route?: string;
  spotlightPadding?: number;
}

export interface TourConfig {
  id: string;
  name: string;
  steps: TourStep[];
}

export interface TourProgress {
  completed: boolean;
  lastStep: number;
  completedAt?: string;
}

export interface OnboardingState {
  hasSeenWelcome: boolean;
  tourProgress: Record<string, TourProgress>;
  skipAllTours: boolean;
}

export interface OnboardingActions {
  setHasSeenWelcome: (seen: boolean) => void;
  updateTourProgress: (tourId: string, step: number, completed: boolean) => void;
  resetTour: (tourId: string) => void;
  setSkipAllTours: (skip: boolean) => void;
  resetAllOnboarding: () => void;
}

export type OnboardingStore = OnboardingState & OnboardingActions;

export type TourPlacement = Placement;

export const TOUR_IDS = {
  ADMIN: 'admin-tour',
  WAITER: 'waiter-tour',
  KITCHEN: 'kitchen-tour',
} as const;

export type TourId = (typeof TOUR_IDS)[keyof typeof TOUR_IDS];
