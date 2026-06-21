import { createContext, useContext, ReactNode, useCallback } from 'react';
import Joyride from 'react-joyride';
import { useOnboarding } from './hooks/useOnboarding';
import { WelcomeModal } from './WelcomeModal';
import { TourTooltip } from './TourTooltip';
import { TOUR_STYLES } from './constants';
import { TourStep } from './tours/types';
import { useEnterDemo } from '../demo/useDemo';

interface OnboardingContextValue {
  isWelcomeModalOpen: boolean;
  isTourRunning: boolean;
  currentStep: number;
  steps: TourStep[];
  tourId: string | null;
  openWelcomeModal: () => void;
  closeWelcomeModal: () => void;
  startTour: () => void;
  skipTour: () => void;
  resetOnboarding: () => void;
  hasCompletedTour: boolean;
  shouldShowWelcome: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboardingContext() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error(
      'useOnboardingContext must be used within OnboardingProvider'
    );
  }
  return context;
}

interface OnboardingProviderProps {
  children: ReactNode;
}

export function OnboardingProvider({ children }: OnboardingProviderProps) {
  const {
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
  } = useOnboarding();

  const { enterDemo } = useEnterDemo();

  // New-user CTA: switch into the seeded demo restaurant, then auto-run the
  // guided tour so the system introduces itself on real data. Marking the
  // welcome as seen (closeWelcomeModal) keeps it from re-popping on the demo
  // dashboard.
  const exploreDemo = useCallback(async () => {
    closeWelcomeModal();
    const ok = await enterDemo();
    if (ok) startTour();
  }, [closeWelcomeModal, enterDemo, startTour]);

  const contextValue: OnboardingContextValue = {
    isWelcomeModalOpen,
    isTourRunning,
    currentStep,
    steps,
    tourId,
    openWelcomeModal,
    closeWelcomeModal,
    startTour,
    skipTour,
    resetOnboarding,
    hasCompletedTour,
    shouldShowWelcome,
  };

  return (
    <OnboardingContext.Provider value={contextValue}>
      {children}

      {/* Welcome Modal */}
      <WelcomeModal
        isOpen={isWelcomeModalOpen}
        onClose={closeWelcomeModal}
        onStartTour={startTour}
        onSkip={skipTour}
        onExploreDemo={exploreDemo}
      />

      {/* Joyride Tour */}
      {isTourRunning && steps.length > 0 && (
        <Joyride
          key={`tour-${tourId}-${isTourRunning}-${retryNonce}`}
          callback={handleJoyrideCallback}
          continuous
          hideCloseButton={false}
          run={true}
          scrollToFirstStep
          showProgress
          showSkipButton
          stepIndex={currentStep}
          steps={steps}
          disableOverlayClose
          spotlightClicks
          styles={TOUR_STYLES}
          tooltipComponent={TourTooltip}
          locale={{
            back: '',
            close: '',
            last: '',
            next: '',
            skip: '',
          }}
        />
      )}
    </OnboardingContext.Provider>
  );
}

export default OnboardingProvider;
