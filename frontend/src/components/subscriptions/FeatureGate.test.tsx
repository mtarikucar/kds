import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import FeatureGate from './FeatureGate';

const useSubscriptionMock = vi.fn();
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => useSubscriptionMock(),
}));

// Stub UpgradePrompt so we can detect the default upsell without pulling
// in its router/i18n deps.
vi.mock('./UpgradePrompt', () => ({
  default: ({ feature }: { feature: string }) => (
    <div data-testid="upgrade-prompt">upgrade:{feature}</div>
  ),
}));

function ctx({
  hasFeature = () => false,
  hasIntegration = () => false,
  isLoading = false,
}: Partial<{
  hasFeature: (f: string) => boolean;
  hasIntegration: (d: string, v?: string) => boolean;
  isLoading: boolean;
}>) {
  useSubscriptionMock.mockReturnValue({ hasFeature, hasIntegration, isLoading });
}

describe('FeatureGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing while the subscription is still loading', () => {
    ctx({ isLoading: true, hasFeature: () => true });
    const { container } = render(
      <FeatureGate feature="advancedReports">
        <div>secret</div>
      </FeatureGate>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders children when the gated feature is granted', () => {
    ctx({ hasFeature: (f) => f === 'advancedReports' });
    render(
      <FeatureGate feature="advancedReports">
        <div>secret</div>
      </FeatureGate>,
    );
    expect(screen.getByText('secret')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('shows the upgrade prompt (for that feature) when the feature is missing', () => {
    ctx({ hasFeature: () => false });
    render(
      <FeatureGate feature="advancedReports">
        <div>secret</div>
      </FeatureGate>,
    );
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByTestId('upgrade-prompt')).toHaveTextContent(
      'upgrade:advancedReports',
    );
  });

  it('renders the provided fallback instead of the default upgrade prompt', () => {
    ctx({ hasFeature: () => false });
    render(
      <FeatureGate feature="advancedReports" fallback={<div>locked-fallback</div>}>
        <div>secret</div>
      </FeatureGate>,
    );
    expect(screen.getByText('locked-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
  });

  it('ANDs feature + integration gates: missing integration blocks even if feature passes', () => {
    ctx({
      hasFeature: () => true,
      hasIntegration: () => false,
    });
    render(
      <FeatureGate
        feature="deliveryIntegration"
        integration={{ domain: 'delivery', vendor: 'getir' }}
      >
        <div>secret</div>
      </FeatureGate>,
    );
    // Both gates must pass; integration fails → children hidden. No
    // default upgrade prompt for integration-only failures unless feature
    // is also present (it is here) — UpgradePrompt is shown for `feature`.
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByTestId('upgrade-prompt')).toHaveTextContent(
      'upgrade:deliveryIntegration',
    );
  });

  it('passes an integration-only gate when the vendor is granted', () => {
    ctx({
      hasIntegration: (domain, vendor) =>
        domain === 'fiscal' && vendor === undefined,
    });
    render(
      <FeatureGate integration={{ domain: 'fiscal' }}>
        <div>fiscal-ui</div>
      </FeatureGate>,
    );
    expect(screen.getByText('fiscal-ui')).toBeInTheDocument();
  });

  it('renders nothing (no upsell) when an integration-only gate fails and showUpgradePrompt is irrelevant', () => {
    ctx({ hasIntegration: () => false });
    const { container } = render(
      <FeatureGate integration={{ domain: 'fiscal' }}>
        <div>fiscal-ui</div>
      </FeatureGate>,
    );
    // No `feature` prop → the default UpgradePrompt branch is skipped.
    expect(screen.queryByText('fiscal-ui')).toBeNull();
    expect(screen.queryByTestId('upgrade-prompt')).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });
});
