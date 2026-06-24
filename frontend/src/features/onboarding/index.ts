// Components
export { OnboardingProvider, useOnboardingContext } from './OnboardingProvider';
export { WelcomeModal } from './WelcomeModal';
export { TourTooltip } from './TourTooltip';
export { Mascot } from './Mascot';
export { MascotButton } from './MascotButton';

// Hooks
export { useOnboarding } from './hooks/useOnboarding';
export { useTourSteps } from './hooks/useTourSteps';

// Onboarding persistence (server-side per-account state)
export {
  useOnboardingData,
  useUpdateOnboarding,
} from './onboardingApi';
export type {
  OnboardingData,
  UpdateOnboardingPayload,
  TourProgressEntry,
} from './onboardingApi';

// Types
export type {
  TourStep,
  TourConfig,
  TourProgress,
  OnboardingState,
  TourId,
} from './tours/types';
export { TOUR_IDS } from './tours/types';

// Tours
export { adminTour, adminTourSteps } from './tours/adminTour';
export { waiterTour, waiterTourSteps } from './tours/waiterTour';
export { kitchenTour, kitchenTourSteps } from './tours/kitchenTour';

// Constants
export { TOUR_STYLES, FEATURE_CARDS } from './constants';
