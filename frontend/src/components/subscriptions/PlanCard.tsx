import { Check, X, Sparkles, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Plan, BillingCycle, SubscriptionPlanType } from '../../types';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';
import { getCurrencySymbol } from '../../lib/currency';

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
  /**
   * Tenant is eligible for a free trial on this plan (per-plan model:
   * a BASIC-trialed tenant can still trial PRO). Drives a green
   * "Sizin için 14 gün ücretsiz" badge.
   */
  isTrialEligible?: boolean;
  onSelectPlan: (planId: string) => void;
  isLoading?: boolean;
  buttonText?: string;
  /**
   * When set, the select CTA is rendered as a non-actionable dead-end
   * guard: the button is disabled and carries this string as its tooltip
   * (and a small hint line underneath). Used when a non-TRY plan has no
   * working payment path configured so the user doesn't bounce off an
   * unusable checkout. The rest of the card stays fully viewable.
   */
  selectDisabledHint?: string;
}

const PlanCard = ({
  plan,
  billingCycle,
  isCurrentPlan = false,
  isPopular = false,
  isTrialEligible = false,
  onSelectPlan,
  isLoading = false,
  buttonText,
  selectDisabledHint,
}: PlanCardProps) => {
  const { t } = useTranslation('common');

  // Get localized plan name and description
  const planDisplayName = t(`subscriptions.plans.${plan.name}.displayName`, { defaultValue: plan.displayName });
  const planDescription = t(`subscriptions.plans.${plan.name}.description`, { defaultValue: plan.description });

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

  // Currency the plan is billed in. Non-TRY plans have no card rail
  // (PayTR is TRY-only) → bank transfer is the only path, which we badge.
  const planCurrency = plan.currency || 'TRY';
  const isNonTry = planCurrency !== 'TRY';

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
    [SubscriptionPlanType.FREE]: 'border-slate-300',
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
        <h3 className="text-2xl font-bold text-slate-900 mb-2">{planDisplayName}</h3>
        <p className="text-slate-600 text-sm min-h-[40px]">{planDescription}</p>
        {/* Non-TRY plans can only be paid by bank transfer (no PayTR card
            rail for foreign currency), so surface that constraint up front
            with a small badge rather than letting the user discover it at
            checkout. */}
        {isNonTry && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            {t('subscriptions.havaleOnlyBadge', { defaultValue: 'Havale ile ödeme' })}
          </span>
        )}
      </div>

      <div className="mb-6">
        {/* Original price with strikethrough if discounted */}
        {hasDiscount && originalPrice > 0 && (
          <div className="text-lg text-slate-400 line-through mb-1">
            {getCurrencySymbol(planCurrency)}{originalPrice.toFixed(2)}
          </div>
        )}

        <div className="flex items-baseline">
          <span className={cn(
            'text-4xl font-bold',
            hasDiscount ? 'text-red-600' : 'text-slate-900'
          )}>
            {getCurrencySymbol(planCurrency)}{price.toFixed(2)}
          </span>
          {/* Spell the ISO currency code out next to the symbol so the
              billing currency is unambiguous (₺ alone is easy to skim
              past; "TRY"/"USD" makes the rail explicit). */}
          <span className="text-slate-500 ml-1 text-sm font-medium">{planCurrency}</span>
          <span className="text-slate-600 ml-2">
            /{billingCycle === BillingCycle.MONTHLY ? t('pricing.month') : t('pricing.year')}
          </span>
        </div>

        {billingCycle === BillingCycle.YEARLY && price > 0 && (
          <p className="text-sm text-green-600 mt-1">
            {getCurrencySymbol(planCurrency)}{pricePerMonth.toFixed(2)}/{t('pricing.month')} - {t('pricing.save')}{' '}
            {Math.round(((Number(plan.monthlyPrice) * 12 - price) / (Number(plan.monthlyPrice) * 12)) * 100)}%
          </p>
        )}

        {/* Discount info */}
        {hasDiscount && totalSavings > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-sm text-red-600 font-semibold">
              {t('pricing.youSave')}: {getCurrencySymbol(planCurrency)}{totalSavings.toFixed(2)}
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
          isTrialEligible ? (
            // Per-tenant CTA: backend confirmed this tenant hasn't burned
            // their per-plan trial slot yet. Green emphasis converts
            // measurably better than the generic gray "14 günlük deneme"
            // line below.
            <p className="text-sm font-semibold text-emerald-700 mt-1 flex items-center gap-1">
              🎁 {t('pricing.trialPersonalised', { days: plan.trialDays, defaultValue: `Sizin için ${plan.trialDays} gün ücretsiz` })}
            </p>
          ) : (
            <p className="text-sm text-blue-600 mt-1">
              {plan.trialDays} {t('pricing.dayFreeTrial')}
            </p>
          )
        )}
      </div>

      <div className="mb-6 flex-grow">
        <h4 className="font-semibold text-slate-900 mb-3">{t('subscriptions.usageLimits')}:</h4>
        <ul className="space-y-2 mb-4">
          <li className="flex items-center text-sm text-slate-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxUsers)} {isUnlimited(plan.limits.maxUsers) || plan.limits.maxUsers > 1 ? t('subscriptions.users') : t('subscriptions.user')}
            </span>
          </li>
          <li className="flex items-center text-sm text-slate-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxTables)} {isUnlimited(plan.limits.maxTables) || plan.limits.maxTables > 1 ? t('subscriptions.tables') : t('subscriptions.table')}
            </span>
          </li>
          <li className="flex items-center text-sm text-slate-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxProducts)} {isUnlimited(plan.limits.maxProducts) || plan.limits.maxProducts > 1 ? t('subscriptions.products') : t('subscriptions.product')}
            </span>
          </li>
          <li className="flex items-center text-sm text-slate-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxMonthlyOrders)} {isUnlimited(plan.limits.maxMonthlyOrders) || plan.limits.maxMonthlyOrders > 1 ? t('subscriptions.orders') : t('subscriptions.order')}/{t('pricing.month')}
            </span>
          </li>
        </ul>

        <h4 className="font-semibold text-slate-900 mb-3">{t('subscriptions.features')}:</h4>
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
              <li key={key} className="flex items-center text-sm text-slate-700">
                {value ? (
                  <>
                    <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                    <span>{featureLabels[key]}</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-slate-400 mr-2 flex-shrink-0" />
                    <span className="text-slate-400">{featureLabels[key]}</span>
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
        disabled={isCurrentPlan || isLoading || !!selectDisabledHint}
        isLoading={isLoading}
        title={selectDisabledHint || undefined}
      >
        {isCurrentPlan ? t('pricing.currentPlan') : (buttonText || t('pricing.selectPlan'))}
      </Button>
      {/* Dead-end guard hint: a non-TRY plan with no configured payment
          path can't be checked out, so spell that out under the disabled
          CTA instead of silently bouncing the user off checkout. */}
      {selectDisabledHint && !isCurrentPlan && (
        <p className="mt-2 text-xs text-amber-700 text-center">{selectDisabledHint}</p>
      )}
    </div>
  );
};

export default PlanCard;
