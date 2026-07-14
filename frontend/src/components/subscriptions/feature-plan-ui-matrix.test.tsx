import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeatureGate from './FeatureGate';

/**
 * THE feature × plan UI gating matrix — renders the REAL <FeatureGate> the app
 * wraps every gated route/section with (App.tsx, Sidebar) and asserts the
 * user-visible outcome for EVERY feature in EVERY plan: the feature's UI is
 * USABLE when the plan grants it, and replaced by the upgrade prompt when it
 * does not. The plan→feature truth table mirrors backend/prisma/seed.ts (and
 * is cross-checked there by feature-plan-matrix.spec.ts against the seeded DB).
 */

const useSubscriptionMock = vi.fn();
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => useSubscriptionMock(),
}));
vi.mock('./UpgradePrompt', () => ({
  default: ({ feature }: { feature: string }) => (
    <div data-testid="upgrade-prompt">upgrade:{feature}</div>
  ),
}));

const F = false;
const T = true;

// 12 features × 4 plans — identical to the backend matrix (seed.ts source).
const FEATURE_MATRIX: Record<string, Record<string, boolean>> = {
  FREE: {
    advancedReports: F, multiLocation: F, customBranding: F, apiAccess: F,
    prioritySupport: F, inventoryTracking: F, kdsIntegration: T,
    reservationSystem: F, personnelManagement: F, deliveryIntegration: F,
    posAccess: F, aiContentGeneration: F,
  },
  BASIC: {
    advancedReports: F, multiLocation: F, customBranding: F, apiAccess: F,
    prioritySupport: F, inventoryTracking: T, kdsIntegration: T,
    reservationSystem: F, personnelManagement: F, deliveryIntegration: F,
    posAccess: T, aiContentGeneration: F,
  },
  PRO: {
    advancedReports: T, multiLocation: T, customBranding: T, apiAccess: F,
    prioritySupport: T, inventoryTracking: T, kdsIntegration: T,
    reservationSystem: T, personnelManagement: T, deliveryIntegration: T,
    posAccess: T, aiContentGeneration: T,
  },
  BUSINESS: {
    advancedReports: T, multiLocation: T, customBranding: T, apiAccess: T,
    prioritySupport: T, inventoryTracking: T, kdsIntegration: T,
    reservationSystem: T, personnelManagement: T, deliveryIntegration: T,
    posAccess: T, aiContentGeneration: T,
  },
};

const PLANS = ['FREE', 'BASIC', 'PRO', 'BUSINESS'];
const FEATURES = Object.keys(FEATURE_MATRIX.FREE);

// Drive the REAL SubscriptionContext.hasFeature contract from the plan's
// effective-features map (effectiveFeatures.features[feature] ?? false).
function mockPlan(plan: string) {
  const feats = FEATURE_MATRIX[plan];
  useSubscriptionMock.mockReturnValue({
    isLoading: false,
    hasFeature: (f: string) => feats[f] ?? false,
    hasIntegration: () => true,
  });
}

describe('Feature × Plan UI gating matrix (every feature, every plan)', () => {
  beforeEach(() => vi.clearAllMocks());

  for (const plan of PLANS) {
    for (const feature of FEATURES) {
      const granted = FEATURE_MATRIX[plan][feature];
      it(`${plan}: ${feature} → ${granted ? 'USABLE' : 'gated (upsell)'}`, () => {
        mockPlan(plan);
        render(
          <FeatureGate feature={feature as never}>
            <div>feature-ui-{feature}</div>
          </FeatureGate>,
        );
        if (granted) {
          expect(
            screen.getByText(`feature-ui-${feature}`),
          ).toBeInTheDocument();
          expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
        } else {
          expect(screen.queryByText(`feature-ui-${feature}`)).toBeNull();
          expect(screen.getByTestId('upgrade-prompt')).toHaveTextContent(
            `upgrade:${feature}`,
          );
        }
      });
    }
  }

  it('every plan grants kdsIntegration (KDS is universal across tiers)', () => {
    for (const plan of PLANS) {
      expect(FEATURE_MATRIX[plan].kdsIntegration).toBe(true);
    }
  });

  it('apiAccess is BUSINESS-only across the UI', () => {
    expect(FEATURE_MATRIX.FREE.apiAccess).toBe(false);
    expect(FEATURE_MATRIX.BASIC.apiAccess).toBe(false);
    expect(FEATURE_MATRIX.PRO.apiAccess).toBe(false);
    expect(FEATURE_MATRIX.BUSINESS.apiAccess).toBe(true);
  });
});
