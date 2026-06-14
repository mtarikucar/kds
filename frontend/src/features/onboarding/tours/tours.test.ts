import { describe, it, expect } from 'vitest';
import { adminTour, adminTourSteps } from './adminTour';
import { waiterTour, waiterTourSteps } from './waiterTour';
import { kitchenTour, kitchenTourSteps } from './kitchenTour';
import { TOUR_IDS, COMPLETION_STEP } from './types';

/**
 * Specs for the static tour configs. These are data, but the data has
 * invariants the runtime relies on: each tour's id matches its TOUR_IDS
 * constant, every tour ends with the shared COMPLETION_STEP, and the
 * step keys in useTourSteps.getStepKey are index-aligned with these
 * arrays (so the counts must stay fixed). Pinning the shapes here guards
 * against an accidental reorder/drop that would silently mistranslate or
 * skip a step.
 */

describe('tour config identity', () => {
  it('adminTour is keyed ADMIN and named', () => {
    expect(adminTour.id).toBe(TOUR_IDS.ADMIN);
    expect(adminTour.name).toBe('Admin Tour');
    expect(adminTour.steps).toBe(adminTourSteps);
  });

  it('waiterTour is keyed WAITER', () => {
    expect(waiterTour.id).toBe(TOUR_IDS.WAITER);
    expect(waiterTour.steps).toBe(waiterTourSteps);
  });

  it('kitchenTour is keyed KITCHEN', () => {
    expect(kitchenTour.id).toBe(TOUR_IDS.KITCHEN);
    expect(kitchenTour.steps).toBe(kitchenTourSteps);
  });
});

describe('tour step counts (index-aligned with useTourSteps.getStepKey)', () => {
  it('admin has 12 steps, waiter 5, kitchen 5', () => {
    expect(adminTourSteps).toHaveLength(12);
    expect(waiterTourSteps).toHaveLength(5);
    expect(kitchenTourSteps).toHaveLength(5);
  });
});

describe('completion step contract', () => {
  it('every tour terminates with the shared COMPLETION_STEP', () => {
    expect(adminTourSteps[adminTourSteps.length - 1]).toBe(COMPLETION_STEP);
    expect(waiterTourSteps[waiterTourSteps.length - 1]).toBe(COMPLETION_STEP);
    expect(kitchenTourSteps[kitchenTourSteps.length - 1]).toBe(COMPLETION_STEP);
  });

  it('COMPLETION_STEP targets body and hides its spotlight', () => {
    expect(COMPLETION_STEP.target).toBe('body');
    expect((COMPLETION_STEP.styles as any).spotlight.display).toBe('none');
  });
});

describe('step targeting', () => {
  it('every non-completion step has a data-tour target selector', () => {
    for (const step of [...adminTourSteps, ...waiterTourSteps, ...kitchenTourSteps]) {
      if (step === COMPLETION_STEP) continue;
      expect(String(step.target)).toMatch(/^\[data-tour="/);
    }
  });
});
