import { Check, X, Sparkles, Clock, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Plan, BillingCycle } from '../../types';
import { cn } from '../../lib/utils';
import { getCurrencySymbol } from '../../lib/currency';

const display = { fontFamily: '"Fraunces", Georgia, serif' } as const;

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
   * "Sizin için 7 gün ücretsiz" badge.
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

  // All 12 plan features mapped to localized labels so every flag renders a
  // real, accurate label (no blank rows for the newer flags).
  const featureLabels: Record<string, string> = {
    advancedReports: t('subscriptions.featureAdvancedReports'),
    multiLocation: t('subscriptions.featureMultiLocation'),
    customBranding: t('subscriptions.featureCustomBranding'),
    apiAccess: t('subscriptions.featureApiAccess'),
    prioritySupport: t('subscriptions.featurePrioritySupport'),
    inventoryTracking: t('subscriptions.featureInventoryTracking'),
    kdsIntegration: t('subscriptions.featureKdsIntegration'),
    posAccess: t('subscriptions.featurePosAccess'),
    reservationSystem: t('subscriptions.featureReservationSystem'),
    personnelManagement: t('subscriptions.featurePersonnelManagement'),
    deliveryIntegration: t('subscriptions.featureDeliveryIntegration'),
    externalDisplay: t('subscriptions.featureExternalDisplay'),
  };

  // Disabled / dead-end CTA → keep it non-actionable, otherwise the
  // highlighted (popular) card gets a filled orange button, the rest a
  // neutral cream/ink button.
  const ctaDisabled = isCurrentPlan || isLoading || !!selectDisabledHint;

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-2xl border bg-white p-7 transition-all duration-300',
        isPopular
          ? 'border-[#f97316] ring-1 ring-[#f97316] shadow-xl shadow-orange-500/10 lg:-translate-y-3 lg:scale-[1.02]'
          : 'border-[#ece2d4] shadow-sm shadow-stone-900/5 hover:-translate-y-1 hover:border-[#f5c9a3] hover:shadow-xl hover:shadow-stone-900/5',
        isCurrentPlan && 'bg-[#faf6f0]',
        hasDiscount && 'border-[#f97316] ring-1 ring-[#f97316]'
      )}
    >
      {/* Discount Badge */}
      {hasDiscount && (
        <div className="absolute -top-3.5 -right-3.5 z-10">
          <div className="flex items-center gap-1 rounded-full bg-[#f97316] px-3 py-1.5 text-sm font-bold text-white shadow-lg shadow-orange-500/30">
            <Sparkles className="h-4 w-4" />
            {plan.discount!.percentage}% {t('pricing.off')}
          </div>
        </div>
      )}

      {isPopular && !hasDiscount && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
          <span className="rounded-full bg-[#f97316] px-4 py-1 text-sm font-semibold text-white shadow-md shadow-orange-500/25">
            ⭐ {t('pricing.mostPopular')}
          </span>
        </div>
      )}

      {isCurrentPlan && (
        <div className="absolute -top-3.5 right-4">
          <span className="rounded-full bg-emerald-600 px-4 py-1 text-sm font-semibold text-white shadow-sm">
            {t('pricing.currentPlan')}
          </span>
        </div>
      )}

      <div className="mb-5">
        <h3 className="mb-2 text-2xl font-semibold text-[#1c1917]" style={display}>{planDisplayName}</h3>
        <p className="min-h-[40px] text-sm leading-relaxed text-[#78716c]">{planDescription}</p>
        {/* Non-TRY plans can only be paid by bank transfer (no PayTR card
            rail for foreign currency), so surface that constraint up front
            with a small badge rather than letting the user discover it at
            checkout. */}
        {isNonTry && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-2.5 py-0.5 text-xs font-medium text-[#b45309]">
            {t('subscriptions.havaleOnlyBadge', { defaultValue: 'Havale ile ödeme' })}
          </span>
        )}
      </div>

      <div className="mb-6">
        {/* Original price with strikethrough if discounted */}
        {hasDiscount && originalPrice > 0 && (
          <div className="mb-1 text-lg text-[#a8a29e] line-through">
            {getCurrencySymbol(planCurrency)}{originalPrice.toFixed(2)}
          </div>
        )}

        <div className="flex items-baseline">
          <span
            className={cn('text-[2.75rem] font-semibold leading-none', hasDiscount ? 'text-[#ea580c]' : 'text-[#1c1917]')}
            style={display}
          >
            {getCurrencySymbol(planCurrency)}{price.toFixed(2)}
          </span>
          {/* Spell the ISO currency code out next to the symbol so the
              billing currency is unambiguous (₺ alone is easy to skim
              past; "TRY"/"USD" makes the rail explicit). */}
          <span className="ml-1.5 text-sm font-medium text-[#a8a29e]">{planCurrency}</span>
          <span className="ml-1.5 text-[#78716c]">
            /{billingCycle === BillingCycle.MONTHLY ? t('pricing.month') : t('pricing.year')}
          </span>
        </div>

        {billingCycle === BillingCycle.YEARLY && price > 0 && (
          <p className="mt-2 text-sm font-medium text-[#b45309]">
            {getCurrencySymbol(planCurrency)}{pricePerMonth.toFixed(2)}/{t('pricing.month')} · {t('pricing.save')}{' '}
            {Math.round(((Number(plan.monthlyPrice) * 12 - price) / (Number(plan.monthlyPrice) * 12)) * 100)}%
          </p>
        )}

        {/* Discount info */}
        {hasDiscount && totalSavings > 0 && (
          <div className="mt-2 space-y-1">
            <p className="text-sm font-semibold text-[#ea580c]">
              {t('pricing.youSave')}: {getCurrencySymbol(planCurrency)}{totalSavings.toFixed(2)}
            </p>
            <div className="flex items-center gap-1 text-xs text-[#b45309]">
              <Clock className="h-3 w-3" />
              <span>
                {plan.discount!.label} - {t('pricing.endsOn')} {formatEndDate(plan.discount!.endDate)}
              </span>
            </div>
          </div>
        )}

        {plan.trialDays > 0 && !hasDiscount && (
          isTrialEligible ? (
            // Per-tenant CTA: backend confirmed this tenant hasn't burned
            // their per-plan trial slot yet. Warm emphasis converts
            // measurably better than the generic line below.
            <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-[#b45309]">
              🎁 {t('pricing.trialPersonalised', { days: plan.trialDays, defaultValue: `Sizin için ${plan.trialDays} gün ücretsiz` })}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[#78716c]">
              {plan.trialDays} {t('pricing.dayFreeTrial')}
            </p>
          )
        )}
      </div>

      <div className="mb-6 flex-grow">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#a8a29e]">{t('subscriptions.usageLimits')}</h4>
        <ul className="mb-5 space-y-2.5">
          <li className="flex items-center text-sm text-[#44403c]">
            <Check className="mr-2.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
            <span>
              {formatLimit(plan.limits.maxUsers)} {isUnlimited(plan.limits.maxUsers) || plan.limits.maxUsers > 1 ? t('subscriptions.users') : t('subscriptions.user')}
            </span>
          </li>
          <li className="flex items-center text-sm text-[#44403c]">
            <Check className="mr-2.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
            <span>
              {formatLimit(plan.limits.maxTables)} {isUnlimited(plan.limits.maxTables) || plan.limits.maxTables > 1 ? t('subscriptions.tables') : t('subscriptions.table')}
            </span>
          </li>
          <li className="flex items-center text-sm text-[#44403c]">
            <Check className="mr-2.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
            <span>
              {formatLimit(plan.limits.maxProducts)} {isUnlimited(plan.limits.maxProducts) || plan.limits.maxProducts > 1 ? t('subscriptions.products') : t('subscriptions.product')}
            </span>
          </li>
          <li className="flex items-center text-sm text-[#44403c]">
            <Check className="mr-2.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
            <span>
              {formatLimit(plan.limits.maxMonthlyOrders)} {isUnlimited(plan.limits.maxMonthlyOrders) || plan.limits.maxMonthlyOrders > 1 ? t('subscriptions.orders') : t('subscriptions.order')}/{t('pricing.month')}
            </span>
          </li>
        </ul>

        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#a8a29e]">{t('subscriptions.features')}</h4>
        <ul className="space-y-2.5">
          {Object.entries(plan.features).map(([key, value]) => (
            <li key={key} className="flex items-center text-sm">
              {value ? (
                <>
                  <Check className="mr-2.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                  <span className="text-[#44403c]">{featureLabels[key]}</span>
                </>
              ) : (
                <>
                  <X className="mr-2.5 h-4 w-4 flex-shrink-0 text-[#d6ccbd]" />
                  <span className="text-[#a8a29e]">{featureLabels[key]}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => onSelectPlan(plan.id)}
        disabled={ctaDisabled}
        aria-busy={isLoading || undefined}
        title={selectDisabledHint || undefined}
        className={cn(
          'group inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
          isPopular || hasDiscount
            ? 'bg-[#f97316] text-white shadow-lg shadow-orange-500/20 hover:bg-[#ea580c]'
            : 'border border-[#e3d7c7] bg-white text-[#1c1917] hover:border-[#cdbfac] hover:bg-[#faf6f0]',
          isCurrentPlan && 'bg-[#f1e8db] text-[#78716c] shadow-none hover:bg-[#f1e8db]'
        )}
      >
        {isLoading ? (
          <>
            <svg className="-ml-1 mr-1 h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {t('app.loading')}
          </>
        ) : isCurrentPlan ? (
          t('pricing.currentPlan')
        ) : (
          <>
            {buttonText || t('pricing.selectPlan')}
            {(isPopular || hasDiscount) && <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />}
          </>
        )}
      </button>
      {/* Dead-end guard hint: a non-TRY plan with no configured payment
          path can't be checked out, so spell that out under the disabled
          CTA instead of silently bouncing the user off checkout. */}
      {selectDisabledHint && !isCurrentPlan && (
        <p className="mt-2 text-center text-xs text-[#b45309]">{selectDisabledHint}</p>
      )}
    </div>
  );
};

export default PlanCard;
