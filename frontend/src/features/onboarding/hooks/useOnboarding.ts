import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { CallBackProps, STATUS, EVENTS, ACTIONS } from 'react-joyride';
import { useUiStore } from '../../../store/uiStore';
import { useAuthStore } from '../../../store/authStore';
import { useTourSteps } from './useTourSteps';
import { TourStep } from '../tours/types';
import {
  useOnboardingData,
  useUpdateOnboarding,
  type UpdateOnboardingPayload,
} from '../onboardingApi';

// Tour targets that require POSPage to be in 'order' view. The onboarding
// flow flips uiStore.posTourPreview when one of these is the active step so
// POSPage can render menu-panel + order-cart (otherwise gated by
// currentView === 'order' && isDesktop).
const POS_ORDER_VIEW_TARGETS = new Set<string>([
  '[data-tour="menu-panel"]',
  '[data-tour="order-cart"]',
]);

// Wait up to this long for an async/conditional target to appear before
// giving up on a step. POSPage state→render→DOM takes a couple of frames;
// route transitions need a bit more.
const TARGET_RETRY_DELAY_MS = 800;

interface UseOnboardingReturn {
  // State
  isWelcomeModalOpen: boolean;
  isTourRunning: boolean;
  currentStep: number;
  steps: TourStep[];
  tourId: string | null;
  retryNonce: number;

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
  const demoMode = useAuthStore((state) => state.demoMode);
  const { tourConfig, steps, tourId } = useTourSteps();

  const {
    onboarding,
    setHasSeenWelcome,
    updateTourProgress,
    setSkipAllTours,
    resetAllOnboarding,
    setPosTourPreview,
    hydrateOnboarding,
  } = useUiStore();

  // Server-side onboarding store (per account). Skip entirely while exploring
  // the shared demo restaurant: that session is access-only and ephemeral, so
  // its tour state must not overwrite the real account's progress.
  const enableServerSync = !!user && !demoMode;
  const { data: serverOnboarding } = useOnboardingData(enableServerSync);
  const updateOnboarding = useUpdateOnboarding();

  // Hydrate local state from the account once the server responds, so a fresh
  // browser/device inherits a prior "skip all tours" / "seen welcome" /
  // completed-tour dismissal instead of re-triggering the intro. Runs once per
  // fetched payload (the server is source of truth on boot).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!enableServerSync) {
      hydratedRef.current = false;
      return;
    }
    if (serverOnboarding && !hydratedRef.current) {
      hydratedRef.current = true;
      // Normalize the server's partial tour-progress entries to the store's
      // strict shape (completed/lastStep are optional over the wire).
      const normalizedProgress: Record<
        string,
        { completed: boolean; lastStep: number; completedAt?: string }
      > = {};
      for (const [id, p] of Object.entries(serverOnboarding.tourProgress ?? {})) {
        normalizedProgress[id] = {
          completed: p?.completed ?? false,
          lastStep: p?.lastStep ?? 0,
          completedAt: p?.completedAt,
        };
      }
      hydrateOnboarding({
        hasSeenWelcome: serverOnboarding.hasSeenWelcome,
        skipAllTours: serverOnboarding.skipAllTours,
        tourProgress: normalizedProgress,
      });
    }
  }, [enableServerSync, serverOnboarding, hydrateOnboarding]);

  // Best-effort write-through to the account. Fire-and-forget; localStorage
  // (uiStore) is already updated by the caller and stays the offline cache.
  const persistOnboarding = useCallback(
    (payload: UpdateOnboardingPayload) => {
      if (!enableServerSync) return;
      updateOnboarding.mutate(payload);
    },
    [enableServerSync, updateOnboarding]
  );

  const [isWelcomeModalOpen, setIsWelcomeModalOpen] = useState(false);
  const [isTourRunning, setIsTourRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  // Bumped after a successful TARGET_NOT_FOUND retry to force Joyride to
  // remount and re-search the DOM (it doesn't poll on its own).
  const [retryNonce, setRetryNonce] = useState(0);
  // Tracks the step index currently waiting on a retry timer, so repeat
  // TARGET_NOT_FOUND events for the same step don't queue multiple skips.
  const retryRef = useRef<number | null>(null);

  const hasCompletedTour = tourId
    ? onboarding.tourProgress[tourId]?.completed ?? false
    : false;

  // Wait for the server fetch to resolve (or be skipped) before deciding to
  // show the welcome modal, so a fresh browser that has actually dismissed it
  // on the account doesn't flash the modal before hydration lands.
  const onboardingHydrated = !enableServerSync || serverOnboarding !== undefined;

  const shouldShowWelcome =
    !!user &&
    onboardingHydrated &&
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

  // Toggle POSPage tour preview based on the active step. Only flip on while
  // the active step targets a node that lives inside the POS 'order' view;
  // POSPage restores its own previous view when the flag clears.
  useEffect(() => {
    if (!isTourRunning) {
      setPosTourPreview(false);
      return;
    }
    const step = steps[currentStep];
    const target = step?.target;
    const needsOrderView =
      step?.route === '/pos' &&
      typeof target === 'string' &&
      POS_ORDER_VIEW_TARGETS.has(target);
    setPosTourPreview(needsOrderView);
  }, [isTourRunning, currentStep, steps, setPosTourPreview]);

  // Clear any pending retry tracker when the active step changes so the next
  // step starts with a clean slate.
  useEffect(() => {
    retryRef.current = null;
  }, [currentStep]);

  const openWelcomeModal = useCallback(() => {
    setIsWelcomeModalOpen(true);
  }, []);

  const closeWelcomeModal = useCallback(() => {
    setIsWelcomeModalOpen(false);
    setHasSeenWelcome(true);
    persistOnboarding({ hasSeenWelcome: true });
  }, [setHasSeenWelcome, persistOnboarding]);

  const startTour = useCallback(() => {
    setIsWelcomeModalOpen(false);
    setHasSeenWelcome(true);
    persistOnboarding({ hasSeenWelcome: true });

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
  }, [steps, location.pathname, navigate, setHasSeenWelcome, persistOnboarding]);

  const skipTour = useCallback(() => {
    setIsWelcomeModalOpen(false);
    setHasSeenWelcome(true);
    setSkipAllTours(true);
    setIsTourRunning(false);
    persistOnboarding({ hasSeenWelcome: true, skipAllTours: true });
  }, [setHasSeenWelcome, setSkipAllTours, persistOnboarding]);

  // Write tour progress locally and mirror it to the account. Completion
  // (completed === true) is the bit that must survive a device switch so the
  // tour doesn't re-trigger, so always persist that; intermediate step
  // updates also write through (cheap, keeps lastStep in sync).
  const syncTourProgress = useCallback(
    (id: string, step: number, completed: boolean) => {
      updateTourProgress(id, step, completed);
      persistOnboarding({
        tourProgress: {
          [id]: {
            completed,
            lastStep: step,
            completedAt: completed ? new Date().toISOString() : undefined,
          },
        },
      });
    },
    [updateTourProgress, persistOnboarding]
  );

  const handleJoyrideCallback = useCallback(
    (data: CallBackProps) => {
      const { action, index, status, type, lifecycle } = data;

      // Handle close button (X) click
      if (action === ACTIONS.CLOSE) {
        setIsTourRunning(false);
        setCurrentStep(0);
        if (tourId) {
          syncTourProgress(tourId, index, false);
        }
        return;
      }

      // Handle tour completion (only STATUS.FINISHED)
      // Note: LIFECYCLE.COMPLETE fires after each step animation, not tour completion
      if (status === STATUS.FINISHED) {
        setIsTourRunning(false);
        setCurrentStep(0);
        if (tourId) {
          syncTourProgress(tourId, steps.length - 1, true);
        }
        return;
      }

      // Handle tour skip
      if (status === STATUS.SKIPPED) {
        setIsTourRunning(false);
        setCurrentStep(0);
        if (tourId) {
          syncTourProgress(tourId, index, false);
        }
        return;
      }

      // Handle step changes
      if (type === EVENTS.STEP_AFTER) {
        // The CLOSE branch above already returned — react-joyride's typing
        // for STEP_AFTER doesn't include 'close' in the action union, so
        // a redundant check here is a TS error. The defence is at the top
        // of this callback, which is the earliest point we know about it.
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
            syncTourProgress(tourId, nextIndex, false);
          }
        } else if (nextIndex >= steps.length) {
          // Tour completed - clicked "Finish" on last step
          setIsTourRunning(false);
          setCurrentStep(0);
          if (tourId) {
            syncTourProgress(tourId, steps.length - 1, true);
          }
        }
      }

      // Target missing — usually because the host page hasn't finished
      // mounting the conditional node yet (e.g. POS view transitions, async
      // data). Wait once, then check again before giving up on the step.
      if (type === EVENTS.TARGET_NOT_FOUND) {
        if (retryRef.current === index) {
          // Timer already pending for this step; let it resolve.
          return;
        }
        retryRef.current = index;
        const target = steps[index]?.target;

        setTimeout(() => {
          if (retryRef.current !== index) {
            // Step changed under us (user clicked next, skip, etc.).
            return;
          }
          retryRef.current = null;

          // Target appeared during the wait → force Joyride to remount and
          // re-evaluate the DOM (it doesn't poll on its own).
          if (typeof target === 'string' && document.querySelector(target)) {
            setRetryNonce((n) => n + 1);
            return;
          }

          // Still missing — advance past it.
          const nextIndex = index + 1;
          if (nextIndex < steps.length) {
            const nextStep = steps[nextIndex];
            if (nextStep.route && location.pathname !== nextStep.route) {
              navigate(nextStep.route);
            }
            setTimeout(() => {
              setCurrentStep(nextIndex);
            }, 300);
          } else {
            setIsTourRunning(false);
            if (tourId) {
              syncTourProgress(tourId, steps.length - 1, true);
            }
          }
        }, TARGET_RETRY_DELAY_MS);
      }
    },
    [steps, tourId, location.pathname, navigate, syncTourProgress]
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
    retryNonce,
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
