import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CallBackProps, STATUS, EVENTS, ACTIONS } from 'react-joyride';
import { useUiStore } from '../../../store/uiStore';
import { useAuthStore } from '../../../store/authStore';
import { useTourSteps } from './useTourSteps';
import { TourStep } from '../tours/types';

interface UseOnboardingReturn {
  // State
  isWelcomeModalOpen: boolean;
  isTourRunning: boolean;
  currentStep: number;
  steps: TourStep[];
  tourId: string | null;

  // Actions
  openWelcomeModal: () => void;
  closeWelcomeModal: () => void;
  startTour: () => void;
  skipTour: () => void;
  handleJoyrideCallback: (data: CallBackProps) => void;
  resetOnboarding: () => void;

  // Status
  hasCompletedTour: boolean;
  shouldShowWelcome: boolean;
}

export function useOnboarding(): UseOnboardingReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const { tourConfig, steps, tourId } = useTourSteps();

  const {
    onboarding,
    setHasSeenWelcome,
    updateTourProgress,
    setSkipAllTours,
    resetAllOnboarding,
  } = useUiStore();

  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(false);
  const [isTourRunning, setIsTourRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const hasCompletedTour = tourId
    ? onboarding.tourProgress[tourId]?.completed ?? false
    : false;

  const shouldShowWelcome =
    !!user &&
    !onboarding.hasSeenWelcome &&
    !onboarding.skipAllTours &&
    !hasCompletedTour;

  // Show welcome modal for new users
  useEffect(() => {
    if (shouldShowWelcome && location.pathname === '/dashboard') {
      const timer = setTimeout(() => {
        setIsWelcomeModalOpen(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [shouldShowWelcome, location.pathname]);

  const openWelcomeModal = useCallback(() => {
    setIsWelcomeModalOpen(true);
  }, []);

  const closeWelcomeModal = useCallback(() => {
    setIsWelcomeModalOpen(false);
    setHasSeenWelcome(true);
  }, [setHasSeenWelcome]);

  const startTour = useCallback(() => {
    setIsWelcomeModalOpen(false);
    setHasSeenWelcome(true);

    if (steps.length > 0) {
      // Navigate to the first step's route if specified
      const firstStep = steps[0];
      if (firstStep.route && location.pathname !== firstStep.route) {
        navigate(firstStep.route);
      }

      // Start tour after navigation
      setTimeout(() => {
        setCurrentStep(0);
        setIsTourRunning(true);
      }, 300);
    }
  }, [steps, location.pathname, navigate, setHasSeenWelcome]);

  const skipTour = useCallback(() => {
    setIsWelcomeModalOpen(false);
    setHasSeenWelcome(true);
    setSkipAllTours(true);
    setIsTourRunning(false);
  }, [setHasSeenWelcome, setSkipAllTours]);

  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type, lifecycle } = data;

      // Handle close button (X) click
      if (action === ACTIONS.CLOSE) {
        setIsTourRunning(false);
        setCurrentStep(0);
        if (tourId) {
          updateTourProgress(tourId, index, false);
        }
        return;
      }

      // Handle tour completion (only STATUS.FINISHED)
      // Note: LIFECYCLE.COMPLETE fires after each step animation, not tour completion
      if (status === STATUS.FINISHED) {
        setIsTourRunning(false);
        setCurrentStep(0);
        if (tourId) {
          updateTourProgress(tourId, steps.length - 1, true);
        }
        return;
      }

      // Handle tour skip
      if (status === STATUS.SKIPPED) {
        setIsTourRunning(false);
        setCurrentStep(0);
        if (tourId) {
          updateTourProgress(tourId, index, false);
        }
        return;
      }

      // Handle step changes
      if (type === EVENTS.STEP_AFTER) {
        // Don't process if it was a close action
        if (action === ACTIONS.CLOSE) {
          return;
        }

        const nextIndex = action === ACTIONS.PREV ? index - 1 : index + 1;

        if (nextIndex >= 0 && nextIndex < steps.length) {
          const nextStep = steps[nextIndex];

          // Navigate to new route if needed
          if (nextStep.route && location.pathname !== nextStep.route) {
            navigate(nextStep.route);
            // Delay step change to allow navigation
            setTimeout(() => {
              setCurrentStep(nextIndex);
            }, 300);
          } else {
            setCurrentStep(nextIndex);
          }

          // Update progress
          if (tourId) {
            updateTourProgress(tourId, nextIndex, false);
          }
        } else if (nextIndex >= steps.length) {
          // Tour completed - clicked "Finish" on last step
          setIsTourRunning(false);
          setCurrentStep(0);
          if (tourId) {
            updateTourProgress(tourId, steps.length - 1, true);
          }
        }
      }

      // Handle tooltip close
      if (type === EVENTS.TARGET_NOT_FOUND) {
        // Skip to next step if target not found
        const nextIndex = index + 1;
        if (nextIndex < steps.length) {
          const nextStep = steps[nextIndex];
          if (nextStep.route) {
            navigate(nextStep.route);
          }
          setTimeout(() => {
            setCurrentStep(nextIndex);
          }, 300);
        } else {
          setIsTourRunning(false);
          if (tourId) {
            updateTourProgress(tourId, steps.length - 1, true);
          }
        }
      }
    },
    [steps, tourId, location.pathname, navigate, updateTourProgress]
  );

  const resetOnboarding = useCallback(() => {
    resetAllOnboarding();
    setIsTourRunning(false);
    setCurrentStep(0);
    setIsWelcomeModalOpen(false);
  }, [resetAllOnboarding]);

  return {
    isWelcomeModalOpen,
    isTourRunning,
    currentStep,
    steps,
    tourId,
    openWelcomeModal,
    closeWelcomeModal,
    startTour,
    skipTour,
    handleJoyrideCallback,
    resetOnboarding,
    hasCompletedTour,
    shouldShowWelcome,
  };
}

export default useOnboarding;
