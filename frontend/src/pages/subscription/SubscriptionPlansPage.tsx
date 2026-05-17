import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useGetPlans,
  useGetCurrentSubscription,
  useGetEffectiveFeatures,
} from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../../components/subscriptions/PlanCard';
import PlanCardSkeleton from '../../components/subscriptions/PlanCardSkeleton';
import PlanComparisonMatrix from '../../components/subscriptions/PlanComparisonMatrix';
import Button from '../../components/ui/Button';
import { BillingCycle, SubscriptionPlanType, Plan } from '../../types';

/**
 * Small "yıllık ödersen X TRY tasarruf ediyorsun" callout shown under
 * the billing toggle. Picks the most expensive paid plan as the
 * example since absolute savings are most impressive there.
 */
function YearlySavingsHint({ plans }: { plans: Plan[] }) {
  const { t } = useTranslation('subscriptions');
  const example = useMemo(() => {
    const paid = plans.filter((p) => Number(p.monthlyPrice) > 0);
    if (paid.length === 0) return null;
    // Sort high → low; first match is the headline saving.
    const sorted = [...paid].sort((a, b) => Number(b.monthlyPrice) - Number(a.monthlyPrice));
    const p = sorted[0];
    const monthly = Number(p.monthlyPrice);
    const yearly = Number(p.yearlyPrice);
    const monthlyTotal = monthly * 12;
    const savings = Math.max(0, monthlyTotal - yearly);
    const effectiveMonthly = yearly / 12;
    const currency = p.currency || 'TRY';
    return { planName: p.displayName, savings, effectiveMonthly, monthly, currency };
  }, [plans]);
  if (!example) return null;
  return (
    <p className="mt-3 text-sm text-emerald-700">
      💡 {t('subscriptions.plansPage.yearlySavingsHint', {
        plan: example.planName,
        savings: example.savings.toFixed(0),
        effective: example.effectiveMonthly.toFixed(0),
        currency: example.currency,
        defaultValue: `${example.planName} planında yıllık ödediğinizde ayda ${example.effectiveMonthly.toFixed(0)} ${example.currency} — toplamda ${example.savings.toFixed(0)} ${example.currency} tasarruf.`,
      })}
    </p>
  );
}

const SubscriptionPlansPage = () => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading } = useGetPlans();
  const { data: currentSubscription } = useGetCurrentSubscription();
  const { data: effective } = useGetEffectiveFeatures();
  const trialEligibleIds = effective?.trialEligiblePlanIds ?? [];

  // Compute savings before any early-return — useMemo was below the
  // conditional returns, which violated rules-of-hooks if the component
  // ever fell through to an early branch on its second render.
  const maxSavingsPercent = useMemo(() => {
    if (!plans) return 20;
    const paidPlans = plans.filter((p: Plan) => Number(p.monthlyPrice) > 0);
    if (paidPlans.length === 0) return 20;
    const savings = paidPlans.map((p: Plan) => {
      const monthlyTotal = Number(p.monthlyPrice) * 12;
      const yearlyTotal = Number(p.yearlyPrice);
      return monthlyTotal > 0 ? Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100) : 0;
    });
    return Math.max(...savings);
  }, [plans]);

  // Handle plan selection — branch by current-subscription status:
  //   - ACTIVE/TRIALING on a different plan → change-plan flow
  //     (proration / scheduled downgrade). Proration math only makes
  //     sense for live billing periods.
  //   - ACTIVE/TRIALING on the same plan → no-op.
  //   - PAST_DUE / EXPIRED / CANCELLED / none → fresh PayTR checkout.
  //     PAST_DUE is included here because proration over a finished
  //     billing period produces negative amounts; renewing via the
  //     checkout flow gets the tenant a fresh full period.
  // For trial-eligible tenants the backend short-circuits to the
  // TRIAL response inside /payments/create-intent; CheckoutPage handles it.
  const handleSelectPlan = (planId: string) => {
    if (processingPlanId) return;
    const liveBillingStatuses = ['ACTIVE', 'TRIALING'];
    const isLiveBilling =
      currentSubscription &&
      liveBillingStatuses.includes(currentSubscription.status);
    if (isLiveBilling) {
      if (currentSubscription.planId === planId) return;
      navigate(`/subscription/change-plan?newPlanId=${planId}&billingCycle=${billingCycle}`);
      return;
    }
    setProcessingPlanId(planId);
    navigate(`/subscription/checkout?planId=${planId}&billingCycle=${billingCycle}`);
  };

  if (plansLoading) {
    // Skeleton placeholders match the eventual 4-column grid so the
    // layout doesn't jump when plans arrive.
    return (
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <div className="h-10 w-72 bg-slate-200 rounded mx-auto mb-4 animate-pulse" />
          <div className="h-5 w-96 bg-slate-100 rounded mx-auto animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <PlanCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600">{t('subscriptions.plansPage.noPlans')}</p>
      </div>
    );
  }

  // Sort plans by price
  const sortedPlans = [...plans].sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">{t('subscriptions.plansPage.title')}</h1>
        <p className="text-lg text-slate-600 mb-8">
          {t('subscriptions.plansPage.subtitle')}
        </p>

        {/* Billing Cycle Toggle */}
        <div className="inline-flex items-center bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setBillingCycle(BillingCycle.MONTHLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${billingCycle === BillingCycle.MONTHLY
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            {t('subscriptions.monthly')}
          </button>
          <button
            onClick={() => setBillingCycle(BillingCycle.YEARLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${billingCycle === BillingCycle.YEARLY
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
              }`}
          >
            {t('subscriptions.yearly')}
            <span className="ml-2 text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
              {t('subscriptions.savePercent', { percent: maxSavingsPercent })}
            </span>
          </button>
        </div>
        {/* Yearly savings transparency — show real numbers when yearly
            is selected; abstract "%17 tasarruf" rarely converts on its
            own. We pick the PRO plan as the canonical example since
            it's the highlighted "popular" tier. */}
        {billingCycle === BillingCycle.YEARLY && (
          <YearlySavingsHint plans={sortedPlans} />
        )}
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
        {sortedPlans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            billingCycle={billingCycle}
            isCurrentPlan={currentSubscription?.planId === plan.id}
            isPopular={plan.name === SubscriptionPlanType.PRO}
            isTrialEligible={trialEligibleIds.includes(plan.id)}
            onSelectPlan={handleSelectPlan}
            isLoading={processingPlanId === plan.id}
          />
        ))}
      </div>

      {/* Current Subscription Info */}
      {currentSubscription && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="text-center">
            <h3 className="font-semibold text-slate-900 mb-2">
              {t('subscriptions.plansPage.haveActiveSubscription')}
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              {t('subscriptions.plansPage.toChangePlan')}
            </p>
            <Button variant="primary" onClick={() => navigate('/admin/settings/subscription')}>
              {t('subscriptions.plansPage.manageSubscription')}
            </Button>
          </div>
        </div>
      )}

      {/* Plan comparison matrix — collapsed by default to keep the
          page scannable. Power users expand it for full feature parity. */}
      <PlanComparisonMatrix plans={sortedPlans} />

      {/* FAQ Section */}
      <div className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">
          {t('subscriptions.plansPage.faqTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div>
            <h3 className="font-semibold text-slate-900 mb-2">{t('subscriptions.plansPage.faqChangePlans')}</h3>
            <p className="text-slate-600 text-sm">
              {t('subscriptions.plansPage.faqChangePlansAnswer')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-2">{t('subscriptions.plansPage.faqPaymentMethods')}</h3>
            <p className="text-slate-600 text-sm">
              {t('subscriptions.plansPage.faqPaymentMethodsAnswer')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-2">{t('subscriptions.plansPage.faqCancelAnytime')}</h3>
            <p className="text-slate-600 text-sm">
              {t('subscriptions.plansPage.faqCancelAnytimeAnswer')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 mb-2">{t('subscriptions.plansPage.faqFreeTrial')}</h3>
            <p className="text-slate-600 text-sm">
              {t('subscriptions.plansPage.faqFreeTrialAnswer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPlansPage;
