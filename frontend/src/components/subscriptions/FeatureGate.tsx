import { ReactNode } from 'react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { PlanFeatures } from '../../types';
import UpgradePrompt from './UpgradePrompt';

interface FeatureGateProps {
  feature: keyof PlanFeatures;
  children: ReactNode;
  fallback?: ReactNode;
  showUpgradePrompt?: boolean;
}

/**
 * Component to conditionally render content based on subscription features.
 * If the feature is not available, shows an upgrade prompt or custom fallback.
 */
const FeatureGate = ({
  feature,
  children,
  fallback,
  showUpgradePrompt = true,
}: FeatureGateProps) => {
  const { hasFeature, isLoading } = useSubscription();

  // While loading, don't render anything
  if (isLoading) {
    return null;
  }

  // If feature is enabled, render children
  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  // If fallback is provided, use it
  if (fallback) {
    return <>{fallback}</>;
  }

  // Show upgrade prompt if enabled
  if (showUpgradePrompt) {
    return <UpgradePrompt feature={feature} />;
  }

  // Otherwise render nothing
  return null;
};

export default FeatureGate;
