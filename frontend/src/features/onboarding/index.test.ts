import { describe, it, expect } from 'vitest';
import * as onboarding from './index';

/**
 * Spec for the onboarding barrel. It's pure re-exports, but the public
 * surface is a contract other features import against — a dropped or
 * renamed re-export would only surface as a runtime "undefined is not a
 * component" elsewhere. Assert the components, hooks, tour configs and
 * constants are all actually exported (not undefined) and that TOUR_IDS
 * carries its three roles.
 */

describe('onboarding barrel exports', () => {
  it('re-exports the provider, hooks and components', () => {
    expect(onboarding.OnboardingProvider).toBeTypeOf('function');
    expect(onboarding.useOnboardingContext).toBeTypeOf('function');
    expect(onboarding.WelcomeModal).toBeTypeOf('function');
    expect(onboarding.TourTooltip).toBeTypeOf('function');
    expect(onboarding.Mascot).toBeTypeOf('function');
    expect(onboarding.MascotButton).toBeTypeOf('function');
    expect(onboarding.useOnboarding).toBeTypeOf('function');
    expect(onboarding.useTourSteps).toBeTypeOf('function');
  });

  it('re-exports the three tour configs', () => {
    expect(onboarding.adminTour.id).toBe(onboarding.TOUR_IDS.ADMIN);
    expect(onboarding.waiterTour.id).toBe(onboarding.TOUR_IDS.WAITER);
    expect(onboarding.kitchenTour.id).toBe(onboarding.TOUR_IDS.KITCHEN);
  });

  it('re-exports TOUR_IDS, TOUR_STYLES and FEATURE_CARDS', () => {
    expect(onboarding.TOUR_IDS).toEqual({
      ADMIN: 'admin-tour',
      WAITER: 'waiter-tour',
      KITCHEN: 'kitchen-tour',
    });
    expect(onboarding.TOUR_STYLES.options.primaryColor).toBe('#3B82F6');
    expect(onboarding.FEATURE_CARDS).toHaveLength(4);
  });
});
