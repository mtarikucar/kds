import { ReactNode } from 'react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { PlanFeatures } from '../../types';
import UpgradePrompt from './UpgradePrompt';

interface FeatureGateProps {
  /**
   * Feature flag to gate on. Either `feature` or `integration` (or
   * both) should be supplied; supplying both ANDs them.
   */
  feature?: keyof PlanFeatures;
  /**
   * v2.8.88 — integration grant to gate on. `vendor` undefined → any
   * vendor in the domain unlocks; `vendor` given → that exact vendor.
   */
  integration?: { domain: string; vendor?: string };
  children: ReactNode;
  fallback?: ReactNode;
  showUpgradePrompt?: boolean;
}

/**
 * Component to conditionally render content based on subscription
 * features OR integration grants. Pre-v2.8.88 it gated only on
 * `feature`; now also supports `integration` (e.g. `{ domain:
 * 'fiscal' }`).
 *
 * v2.8.88: page-root usage wraps an entire admin route so direct-URL
 * access to a feature the tenant doesn't own shows the upsell instead
 * of a 403 toast.
 *
 * @warning UI-ONLY GATE. FeatureGate hides content from the rendered
 * tree; it does NOT prevent the user from invoking the underlying
 * endpoint. Anyone with browser DevTools can flip the subscription
 * context flag and unhide the children, or call the backend directly.
 *
 * Every endpoint behind a FeatureGate MUST also be guarded server-side
 * by `PlanFeatureGuard` + `@RequiresFeature(...)` / `@RequiresIntegration(...)`
 * (or the equivalent EntitlementGuard + `@RequireEntitlement` pair).
 * FeatureGate is presentation polish — the trust boundary is the API.
 */
const FeatureGate = ({
  feature,
  integration,
  children,
  fallback,
  showUpgradePrompt = true,
}: FeatureGateProps) => {
  const { hasFeature, hasIntegration, isLoading } = useSubscription();

  // While loading, don't render anything
  if (isLoading) {
    return null;
  }

  // Both gates (when present) must pass.
  const featurePasses = feature ? hasFeature(feature) : true;
  const integrationPasses = integration
    ? hasIntegration(integration.domain, integration.vendor)
    : true;
  if (featurePasses && integrationPasses) {
    return <>{children}</>;
  }

  // If fallback is provided, use it
  if (fallback) {
    return <>{fallback}</>;
  }

  // Show upgrade prompt if enabled (only for feature flag — integration
  // gating goes through the new UpsellCard fallback pattern).
  if (showUpgradePrompt && feature) {
    return <UpgradePrompt feature={feature} />;
  }

  // Otherwise render nothing
  return null;
};

export default FeatureGate;
