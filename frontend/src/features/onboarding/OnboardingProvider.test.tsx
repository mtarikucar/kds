import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, renderHook } from '@testing-library/react';

/**
 * Specs for OnboardingProvider — exposes the onboarding state from
 * useOnboarding as a context and conditionally mounts the Joyride tour.
 * We mock useOnboarding (the state source) and the heavy children
 * (Joyride / WelcomeModal / TourTooltip) so we can assert: the context
 * value reaches consumers, the tour only mounts when running AND there
 * are steps, and using the context outside a provider throws.
 */

const onboardingState = {
  isWelcomeModalOpen: false,
  isTourRunning: false,
  currentStep: 0,
  steps: [] as any[],
  tourId: null as string | null,
  retryNonce: 0,
  openWelcomeModal: vi.fn(),
  closeWelcomeModal: vi.fn(),
  startTour: vi.fn(),
  skipTour: vi.fn(),
  handleJoyrideCallback: vi.fn(),
  resetOnboarding: vi.fn(),
  hasCompletedTour: false,
  shouldShowWelcome: false,
};
vi.mock('./hooks/useOnboarding', () => ({ useOnboarding: () => onboardingState }));
vi.mock('react-joyride', () => ({ default: () => <div data-testid="joyride" /> }));
vi.mock('./WelcomeModal', () => ({ WelcomeModal: () => <div data-testid="welcome-modal" /> }));
vi.mock('./TourTooltip', () => ({ TourTooltip: () => null }));

import { OnboardingProvider, useOnboardingContext } from './OnboardingProvider';

function Consumer() {
  const ctx = useOnboardingContext();
  return <div data-testid="ctx">{`running:${ctx.isTourRunning} tour:${ctx.tourId}`}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  onboardingState.isTourRunning = false;
  onboardingState.steps = [];
  onboardingState.tourId = null;
});

describe('OnboardingProvider — context', () => {
  it('exposes the onboarding state to consumers', () => {
    onboardingState.tourId = 'admin-tour';
    render(
      <OnboardingProvider>
        <Consumer />
      </OnboardingProvider>,
    );
    expect(screen.getByTestId('ctx').textContent).toBe('running:false tour:admin-tour');
    // The welcome modal is always mounted (visibility controlled by its own prop).
    expect(screen.getByTestId('welcome-modal')).toBeInTheDocument();
  });
});

describe('OnboardingProvider — tour mount gating', () => {
  it('does not mount Joyride when the tour is not running', () => {
    onboardingState.isTourRunning = false;
    onboardingState.steps = [{ target: 'body' }];
    render(
      <OnboardingProvider>
        <span />
      </OnboardingProvider>,
    );
    expect(screen.queryByTestId('joyride')).toBeNull();
  });

  it('does not mount Joyride while running but with no steps', () => {
    onboardingState.isTourRunning = true;
    onboardingState.steps = [];
    render(
      <OnboardingProvider>
        <span />
      </OnboardingProvider>,
    );
    expect(screen.queryByTestId('joyride')).toBeNull();
  });

  it('mounts Joyride when running AND steps are present', () => {
    onboardingState.isTourRunning = true;
    onboardingState.steps = [{ target: 'body' }];
    render(
      <OnboardingProvider>
        <span />
      </OnboardingProvider>,
    );
    expect(screen.getByTestId('joyride')).toBeInTheDocument();
  });
});

describe('useOnboardingContext — guard', () => {
  it('throws when used outside an OnboardingProvider', () => {
    expect(() => renderHook(() => useOnboardingContext())).toThrow(
      /must be used within OnboardingProvider/,
    );
  });
});
