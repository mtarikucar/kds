import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, Sparkles, ArrowRight } from 'lucide-react';
import { PlanFeatures, PlanLimits, SubscriptionPlanType } from '../../types';
import Button from '../ui/Button';

// Map features to their minimum required plan
const featurePlanMap: Record<keyof PlanFeatures, SubscriptionPlanType> = {
  kdsIntegration: SubscriptionPlanType.FREE,
  inventoryTracking: SubscriptionPlanType.BASIC,
  advancedReports: SubscriptionPlanType.PRO,
  multiLocation: SubscriptionPlanType.PRO,
  customBranding: SubscriptionPlanType.PRO,
  prioritySupport: SubscriptionPlanType.PRO,
  apiAccess: SubscriptionPlanType.BUSINESS,
};

// Map limit types to their display names
const limitDisplayNames: Record<keyof PlanLimits, string> = {
  maxUsers: 'users',
  maxTables: 'tables',
  maxProducts: 'products',
  maxCategories: 'categories',
  maxMonthlyOrders: 'monthlyOrders',
};

interface UpgradePromptProps {
  feature?: keyof PlanFeatures;
  limitType?: keyof PlanLimits;
  currentCount?: number;
  limit?: number;
  compact?: boolean;
  className?: string;
}

/**
 * Component to show an upgrade prompt when a feature or limit is restricted.
 */
const UpgradePrompt = ({
  feature,
  limitType,
  currentCount,
  limit,
  compact = false,
  className = '',
}: UpgradePromptProps) => {
  const { t } = useTranslation(['subscriptions', 'common']);
  const navigate = useNavigate();

  const handleUpgrade = () => {
    navigate('/subscription/change-plan');
  };

  // Determine the required plan for upgrade message
  const requiredPlan = feature ? featurePlanMap[feature] : SubscriptionPlanType.PRO;

  // Get feature or limit display name
  const getDisplayName = () => {
    if (feature) {
      return t(`subscriptions:subscriptions.feature${feature.charAt(0).toUpperCase() + feature.slice(1)}`, {
        defaultValue: feature,
      });
    }
    if (limitType) {
      const key = limitDisplayNames[limitType];
      return t(`subscriptions:subscriptions.planLimits.${key}`, { defaultValue: limitType });
    }
    return '';
  };

  // Compact version for inline use
  if (compact) {
    return (
      <div className={`flex items-center gap-2 text-sm text-amber-600 ${className}`}>
        <Lock className="h-4 w-4" />
        <span>
          {limitType && currentCount !== undefined && limit !== undefined
            ? t('subscriptions:subscriptions.limitReached', {
                current: currentCount,
                limit: limit,
              })
            : t('subscriptions:subscriptions.featureRequiresPlan', {
                plan: requiredPlan,
              })}
        </span>
        <button
          onClick={handleUpgrade}
          className="text-blue-600 hover:text-blue-700 font-medium underline"
        >
          {t('subscriptions:subscriptions.upgrade')}
        </button>
      </div>
    );
  }

  // Full version for page-level blocks
  return (
    <div
      className={`bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-8 text-center ${className}`}
    >
      <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full mb-4">
        <Sparkles className="h-8 w-8 text-amber-600" />
      </div>

      <h3 className="text-xl font-bold text-gray-900 mb-2">
        {t('subscriptions:subscriptions.upgradeRequired')}
      </h3>

      <p className="text-gray-600 mb-6 max-w-md mx-auto">
        {limitType && currentCount !== undefined && limit !== undefined ? (
          <>
            {t('subscriptions:subscriptions.limitReachedDescription', {
              resource: getDisplayName(),
              current: currentCount,
              limit: limit,
            })}
          </>
        ) : (
          <>
            {t('subscriptions:subscriptions.featureNotAvailable', {
              feature: getDisplayName(),
            })}
            <br />
            {t('subscriptions:subscriptions.upgradeToAccess', {
              plan: requiredPlan,
            })}
          </>
        )}
      </p>

      <Button variant="primary" onClick={handleUpgrade} className="inline-flex items-center gap-2">
        {t('subscriptions:subscriptions.viewPlans')}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default UpgradePrompt;
