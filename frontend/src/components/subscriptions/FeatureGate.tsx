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
  /**
   * How `feature` and `integration` combine when BOTH are supplied.
   * `'all'` (default) ANDs them — unchanged pre-existing behavior.
   * `'any'` ORs them — passes when EITHER is satisfied. Used for
   * domains where a plan feature and a purchasable add-on grant the
   * same access (e.g. delivery: `feature.deliveryIntegration` OR
   * `integration.delivery`). Has no effect when only one of
   * `feature`/`integration` is supplied.
   */
  mode?: 'all' | 'any';
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
  mode = 'all',
  children,
  fallback,
  showUpgradePrompt = true,
}: FeatureGateProps) => {
  const { hasFeature, hasIntegration, isLoading } = useSubscription();

  // While loading, don't render anything
  if (isLoading) {
    return null;
  }

  const featurePasses = feature ? hasFeature(feature) : true;
  const integrationPasses = integration
    ? hasIntegration(integration.domain, integration.vendor)
    : true;
  // Default: both gates (when present) must pass. `mode="any"` ORs them,
  // but only when both `feature` and `integration` are actually supplied
  // — with just one gate present, "any" and "all" agree.
  const passes =
    mode === 'any' && feature && integration
      ? featurePasses || integrationPasses
      : featurePasses && integrationPasses;
  if (passes) {
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
