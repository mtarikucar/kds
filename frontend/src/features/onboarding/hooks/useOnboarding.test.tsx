import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { STATUS, EVENTS, ACTIONS } from 'react-joyride';
import { useOnboarding } from './useOnboarding';

// --- mocks --------------------------------------------------------------

const navigate = vi.fn();
let pathname = '/dashboard';
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname }),
}));

// Deterministic 3-step tour with a route change on step 2.
const steps = [
  { target: '[data-tour="a"]', route: '/dashboard', content: 'a' },
  { target: '[data-tour="b"]', route: '/pos', content: 'b' },
  { target: '[data-tour="c"]', route: '/pos', content: 'c' },
];
let tourId: string | null = 'admin-tour';
vi.mock('./useTourSteps', () => ({
  useTourSteps: () => ({ tourConfig: { id: tourId, name: 'T', steps }, steps, tourId }),
}));

// Auth + UI stores.
let user: any = { id: 'u1', role: 'ADMIN' };
let demoMode = false;
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: any) => selector({ user, demoMode }),
}));

// Server-side onboarding persistence — mocked so the hook doesn't need a real
// QueryClient. updateOnboarding.mutate captures the write-through payloads.
const updateOnboardingMutate = vi.fn();
let serverOnboarding: any = undefined;
vi.mock('../onboardingApi', () => ({
  useOnboardingData: () => ({ data: serverOnboarding }),
  useUpdateOnboarding: () => ({ mutate: updateOnboardingMutate }),
}));

const updateTourProgress = vi.fn();
const setHasSeenWelcome = vi.fn();
const setSkipAllTours = vi.fn();
const setPosTourPreview = vi.fn();
const resetAllOnboarding = vi.fn();
const hydrateOnboarding = vi.fn();
let onboarding: any = {
  hasSeenWelcome: false,
  skipAllTours: false,
  tourProgress: {},
};
vi.mock('../../../store/uiStore', () => ({
  useUiStore: () => ({
    onboarding,
    setHasSeenWelcome,
    updateTourProgress,
    setSkipAllTours,
    resetAllOnboarding,
    setPosTourPreview,
    hydrateOnboarding,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  pathname = '/dashboard';
  tourId = 'admin-tour';
  user = { id: 'u1', role: 'ADMIN' };
  demoMode = false;
  onboarding = { hasSeenWelcome: false, skipAllTours: false, tourProgress: {} };
  // Server fetch resolved (not undefined) so shouldShowWelcome isn't gated by
  // a pending hydration in these tests.
  serverOnboarding = { hasSeenWelcome: false, skipAllTours: false, tourProgress: {} };
});

describe('useOnboarding.shouldShowWelcome', () => {
  it('is true for a logged-in user who has not seen welcome, not skipped, not completed', () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShowWelcome).toBe(true);
  });

  it('is false when there is no user', () => {
    user = null;
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShowWelcome).toBe(false);
  });

  it('is false once the welcome has been seen', () => {
    onboarding = { ...onboarding, hasSeenWelcome: true };
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShowWelcome).toBe(false);
  });

  it('is false when all tours are skipped', () => {
    onboarding = { ...onboarding, skipAllTours: true };
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShowWelcome).toBe(false);
  });

  it('is false once the tour for this role is already completed', () => {
    onboarding = { ...onboarding, tourProgress: { 'admin-tour': { completed: true } } };
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.shouldShowWelcome).toBe(false);
    expect(result.current.hasCompletedTour).toBe(true);
  });
});

describe('useOnboarding.skipTour', () => {
  it('marks welcome seen and sets the global skip-all flag', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => result.current.skipTour());
    expect(setHasSeenWelcome).toHaveBeenCalledWith(true);
    expect(setSkipAllTours).toHaveBeenCalledWith(true);
    expect(result.current.isTourRunning).toBe(false);
  });
});

describe('useOnboarding.handleJoyrideCallback', () => {
  it('on FINISHED, records completion against the last step index', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.handleJoyrideCallback({
        status: STATUS.FINISHED,
        index: 2,
        action: ACTIONS.NEXT,
        type: EVENTS.TOUR_END,
        lifecycle: 'complete',
      } as any);
    });
    // steps.length - 1 = 2, completed = true.
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 2, true);
    expect(result.current.isTourRunning).toBe(false);
  });

  it('on SKIPPED, records the current index as not completed', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.handleJoyrideCallback({
        status: STATUS.SKIPPED,
        index: 1,
        action: ACTIONS.SKIP,
        type: EVENTS.TOUR_END,
        lifecycle: 'complete',
      } as any);
    });
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 1, false);
  });

  it('on the close (X) action, records the current index as not completed', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.handleJoyrideCallback({
        action: ACTIONS.CLOSE,
        index: 1,
        status: STATUS.RUNNING,
        type: EVENTS.STEP_AFTER,
        lifecycle: 'complete',
      } as any);
    });
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 1, false);
    expect(result.current.isTourRunning).toBe(false);
  });

  it('on STEP_AFTER advancing to a step on a different route, navigates to that route', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      // From step 0 (/dashboard) → next step 1 lives on /pos.
      result.current.handleJoyrideCallback({
        type: EVENTS.STEP_AFTER,
        action: ACTIONS.NEXT,
        index: 0,
        status: STATUS.RUNNING,
        lifecycle: 'complete',
      } as any);
    });
    expect(navigate).toHaveBeenCalledWith('/pos');
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 1, false);
  });

  it('on STEP_AFTER PREV does not change route when the previous step shares the path', () => {
    pathname = '/pos';
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      // From step 2 (/pos) going back to step 1 (/pos) — same route, no navigate.
      result.current.handleJoyrideCallback({
        type: EVENTS.STEP_AFTER,
        action: ACTIONS.PREV,
        index: 2,
        status: STATUS.RUNNING,
        lifecycle: 'complete',
      } as any);
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 1, false);
  });

  it('on STEP_AFTER past the last step, finishes the tour', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.handleJoyrideCallback({
        type: EVENTS.STEP_AFTER,
        action: ACTIONS.NEXT,
        index: 2, // last index; nextIndex 3 >= steps.length
        status: STATUS.RUNNING,
        lifecycle: 'complete',
      } as any);
    });
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 2, true);
    expect(result.current.isTourRunning).toBe(false);
  });
});

/**
 * Review F3 — the TARGET_NOT_FOUND retry must be VISIBILITY-aware. A bare
 * querySelector truthiness check let a present-but-display:none node (e.g.
 * the mobile-drawer duplicate of the settings sidebar) pass, so the hook
 * re-nonced forever: Joyride remounted, failed its own visibility check,
 * fired TARGET_NOT_FOUND again → infinite 800ms loop and the tour never
 * completed. Now: re-nonce ONLY for a visible target (getClientRects), and
 * advance past the step when the target is missing, invisible, or the retry
 * cap is exhausted.
 */
describe('useOnboarding TARGET_NOT_FOUND retry (visibility-aware)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function fireTargetNotFound(result: any, index: number) {
    act(() => {
      result.current.handleJoyrideCallback({
        type: EVENTS.TARGET_NOT_FOUND,
        action: ACTIONS.UPDATE,
        index,
        status: STATUS.RUNNING,
        lifecycle: 'init',
      } as any);
    });
  }

  function mountTarget(tour: string, visible: boolean) {
    const el = document.createElement('div');
    el.setAttribute('data-tour', tour);
    // jsdom has no layout — stub the signal the hook reads explicitly.
    (el as any).getClientRects = () => (visible ? [{ width: 10, height: 10 }] : []);
    document.body.appendChild(el);
    return el;
  }

  it('re-nonces (remounts Joyride) when the target appears AND is visible', () => {
    mountTarget('b', true);
    const { result } = renderHook(() => useOnboarding());
    const nonceBefore = result.current.retryNonce;

    fireTargetNotFound(result, 1);
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current.retryNonce).toBe(nonceBefore + 1);
    // No advance, no navigation — Joyride gets another chance at this step.
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.currentStep).toBe(0);
  });

  it('ADVANCES past the step (no re-nonce) when the target is present but INVISIBLE', () => {
    mountTarget('b', false); // exists in the DOM, display:none-equivalent
    const { result } = renderHook(() => useOnboarding());
    const nonceBefore = result.current.retryNonce;

    fireTargetNotFound(result, 1);
    act(() => {
      vi.advanceTimersByTime(800); // retry timer: sees invisible node → skip
    });

    expect(result.current.retryNonce).toBe(nonceBefore); // never re-nonced
    // Step 2 shares /pos — navigate fires because the mocked pathname is
    // /dashboard, then the 300ms defer lands the step change.
    expect(navigate).toHaveBeenCalledWith('/pos');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.currentStep).toBe(2);
  });

  it('advances when the target is entirely missing from the DOM', () => {
    const { result } = renderHook(() => useOnboarding());

    fireTargetNotFound(result, 1);
    act(() => {
      vi.advanceTimersByTime(800);
      vi.advanceTimersByTime(300);
    });

    expect(result.current.currentStep).toBe(2);
  });

  it('stops re-noncing after the retry cap and advances instead (no infinite loop)', () => {
    mountTarget('b', true); // visible forever, but Joyride keeps rejecting it
    const { result } = renderHook(() => useOnboarding());
    const nonceBefore = result.current.retryNonce;

    // MAX_TARGET_RETRIES = 3 re-nonces, then the 4th attempt must bail out.
    for (let i = 0; i < 3; i++) {
      fireTargetNotFound(result, 1);
      act(() => {
        vi.advanceTimersByTime(800);
      });
    }
    expect(result.current.retryNonce).toBe(nonceBefore + 3);
    expect(result.current.currentStep).toBe(0);

    fireTargetNotFound(result, 1);
    act(() => {
      vi.advanceTimersByTime(800);
      vi.advanceTimersByTime(300);
    });
    expect(result.current.retryNonce).toBe(nonceBefore + 3); // capped
    expect(result.current.currentStep).toBe(2); // advanced past the step
  });

  it('finishes the tour when the last step target never materializes', () => {
    const { result } = renderHook(() => useOnboarding());
    act(() => {
      result.current.startTour();
      vi.advanceTimersByTime(300);
    });
    expect(result.current.isTourRunning).toBe(true);

    fireTargetNotFound(result, 2); // last step, nothing in the DOM
    act(() => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current.isTourRunning).toBe(false);
    expect(updateTourProgress).toHaveBeenCalledWith('admin-tour', 2, true);
  });
});
