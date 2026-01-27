import { createContext, useContext, ReactNode } from 'react';
import Joyride from 'react-joyride';
import { useOnboarding } from './hooks/useOnboarding';
import { WelcomeModal } from './WelcomeModal';
import { TourTooltip } from './TourTooltip';
import { TOUR_STYLES } from './constants';
import { TourStep } from './tours/types';

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
    openWelcomeModal,
    closeWelcomeModal,
    startTour,
    skipTour,
    handleJoyrideCallback,
    resetOnboarding,
    hasCompletedTour,
    shouldShowWelcome,
  } = useOnboarding();

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
      />

      {/* Joyride Tour */}
      {isTourRunning && steps.length > 0 && (
        <Joyride
          key={`tour-${tourId}-${isTourRunning}`}
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
