import { Check, X, Sparkles, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Plan, BillingCycle, SubscriptionPlanType } from '../../types';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';

// Extended Plan type with discount info
interface PlanWithDiscount extends Plan {
  discount?: {
    percentage: number;
    label: string;
    endDate: string;
    discountedMonthlyPrice: number;
    discountedYearlyPrice: number;
  } | null;
}

interface PlanCardProps {
  plan: PlanWithDiscount;
  billingCycle: BillingCycle;
  isCurrentPlan?: boolean;
  isPopular?: boolean;
  onSelectPlan: (planId: string) => void;
  isLoading?: boolean;
  buttonText?: string;
}

const PlanCard = ({
  plan,
  billingCycle,
  isCurrentPlan = false,
  isPopular = false,
  onSelectPlan,
  isLoading = false,
  buttonText,
}: PlanCardProps) => {
  const { t } = useTranslation('common');

  // Check if discount is active
  const hasDiscount = plan.discount !== null && plan.discount !== undefined;

  // Convert price to number in case it comes as Decimal/string from backend
  const originalPrice = Number(billingCycle === BillingCycle.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice);

  // Calculate discounted price if available
  const price = hasDiscount
    ? (billingCycle === BillingCycle.MONTHLY
        ? plan.discount!.discountedMonthlyPrice
        : plan.discount!.discountedYearlyPrice)
    : originalPrice;

  const pricePerMonth = billingCycle === BillingCycle.YEARLY ? price / 12 : price;
  const originalPricePerMonth = billingCycle === BillingCycle.YEARLY ? originalPrice / 12 : originalPrice;

  const isUnlimited = (limit: number) => limit === -1;
  const formatLimit = (limit: number) => (isUnlimited(limit) ? t('subscriptions.unlimited') : limit);

  // Calculate savings
  const totalSavings = hasDiscount ? originalPrice - price : 0;

  // Format end date
  const formatEndDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const planColors = {
    [SubscriptionPlanType.FREE]: 'border-gray-300',
    [SubscriptionPlanType.BASIC]: 'border-blue-300',
    [SubscriptionPlanType.PRO]: 'border-purple-500',
    [SubscriptionPlanType.BUSINESS]: 'border-yellow-500',
  };

  return (
    <div
      className={cn(
        'relative bg-white rounded-xl border-2 shadow-lg p-6 flex flex-col transition-all duration-300',
        isPopular ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-2' : planColors[plan.name],
        isCurrentPlan && 'bg-blue-50',
        hasDiscount && 'ring-2 ring-red-400 ring-offset-2 border-red-400'
      )}
    >
      {/* Discount Badge */}
      {hasDiscount && (
        <div className="absolute -top-4 -right-4 z-10">
          <div className="bg-gradient-to-r from-red-500 to-orange-500 text-white px-3 py-1.5 rounded-full text-sm font-bold shadow-lg flex items-center gap-1 animate-pulse">
            <Sparkles className="w-4 h-4" />
            {plan.discount!.percentage}% {t('pricing.off')}
          </div>
        </div>
      )}

      {isPopular && !hasDiscount && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
            {t('pricing.mostPopular')}
          </span>
        </div>
      )}

      {isCurrentPlan && (
        <div className="absolute -top-4 right-4">
          <span className="bg-green-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
            {t('pricing.currentPlan')}
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.displayName}</h3>
        <p className="text-gray-600 text-sm min-h-[40px]">{plan.description}</p>
      </div>

      <div className="mb-6">
        {/* Original price with strikethrough if discounted */}
        {hasDiscount && originalPrice > 0 && (
          <div className="text-lg text-gray-400 line-through mb-1">
            ${originalPrice.toFixed(2)}
          </div>
        )}

        <div className="flex items-baseline">
          <span className={cn(
            'text-4xl font-bold',
            hasDiscount ? 'text-red-600' : 'text-gray-900'
          )}>
            ${price.toFixed(2)}
          </span>
          <span className="text-gray-600 ml-2">
            /{billingCycle === BillingCycle.MONTHLY ? t('pricing.month') : t('pricing.year')}
          </span>
        </div>

        {billingCycle === BillingCycle.YEARLY && price > 0 && (
          <p className="text-sm text-green-600 mt-1">
            ${pricePerMonth.toFixed(2)}/{t('pricing.month')} - {t('pricing.save')}{' '}
            {Math.round(((Number(plan.monthlyPrice) * 12 - price) / (Number(plan.monthlyPrice) * 12)) * 100)}%
          </p>
        )}

        {/* Discount info */}
        {hasDiscount && totalSavings > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-sm text-red-600 font-semibold">
              {t('pricing.youSave')}: ${totalSavings.toFixed(2)}
            </p>
            <div className="flex items-center gap-1 text-xs text-orange-600">
              <Clock className="w-3 h-3" />
              <span>
                {plan.discount!.label} - {t('pricing.endsOn')} {formatEndDate(plan.discount!.endDate)}
              </span>
            </div>
          </div>
        )}

        {plan.trialDays > 0 && !hasDiscount && (
          <p className="text-sm text-blue-600 mt-1">{plan.trialDays} {t('pricing.dayFreeTrial')}</p>
        )}
      </div>

      <div className="mb-6 flex-grow">
        <h4 className="font-semibold text-gray-900 mb-3">{t('subscriptions.usageLimits')}:</h4>
        <ul className="space-y-2 mb-4">
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxUsers)} {t('subscriptions.user')}{isUnlimited(plan.limits.maxUsers) || plan.limits.maxUsers > 1 ? 's' : ''}
            </span>
          </li>
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxTables)} {t('subscriptions.table')}{isUnlimited(plan.limits.maxTables) || plan.limits.maxTables > 1 ? 's' : ''}
            </span>
          </li>
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxProducts)} {t('subscriptions.product')}{isUnlimited(plan.limits.maxProducts) || plan.limits.maxProducts > 1 ? 's' : ''}
            </span>
          </li>
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxMonthlyOrders)} {t('subscriptions.order')}{isUnlimited(plan.limits.maxMonthlyOrders) || plan.limits.maxMonthlyOrders > 1 ? 's' : ''}/{t('pricing.month')}
            </span>
          </li>
        </ul>

        <h4 className="font-semibold text-gray-900 mb-3">{t('subscriptions.features')}:</h4>
        <ul className="space-y-2">
          {Object.entries(plan.features).map(([key, value]) => {
            const featureLabels: Record<string, string> = {
              advancedReports: t('subscriptions.featureAdvancedReports'),
              multiLocation: t('subscriptions.featureMultiLocation'),
              customBranding: t('subscriptions.featureCustomBranding'),
              apiAccess: t('subscriptions.featureApiAccess'),
              prioritySupport: t('subscriptions.featurePrioritySupport'),
              inventoryTracking: t('subscriptions.featureInventoryTracking'),
              kdsIntegration: t('subscriptions.featureKdsIntegration'),
            };

            return (
              <li key={key} className="flex items-center text-sm text-gray-700">
                {value ? (
                  <>
                    <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                    <span>{featureLabels[key]}</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
                    <span className="text-gray-400">{featureLabels[key]}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <Button
        variant={hasDiscount ? 'danger' : (isPopular ? 'primary' : 'outline')}
        className={cn(
          'w-full',
          hasDiscount && 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600 border-0'
        )}
        onClick={() => onSelectPlan(plan.id)}
        disabled={isCurrentPlan || isLoading}
        isLoading={isLoading}
      >
        {isCurrentPlan ? t('pricing.currentPlan') : (buttonText || t('pricing.selectPlan'))}
      </Button>
    </div>
  );
};

export default PlanCard;
