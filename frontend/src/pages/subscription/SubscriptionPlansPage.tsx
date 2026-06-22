import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useGetPlans,
  useGetCurrentSubscription,
  useGetEffectiveFeatures,
} from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../../components/subscriptions/PlanCard';
import PlanCardSkeleton from '../../components/subscriptions/PlanCardSkeleton';
import PlanComparisonMatrix from '../../components/subscriptions/PlanComparisonMatrix';
import { useBankTransferDetails } from '../../api/paymentsApi';
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
    <p className="mt-3 text-sm font-medium text-[#b45309]">
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
  const [searchParams] = useSearchParams();
  const isRenewFlow = searchParams.get('renew') === '1';
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading } = useGetPlans();
  const { data: currentSubscription } = useGetCurrentSubscription();
  const { data: effective } = useGetEffectiveFeatures();
  const trialEligibleIds = effective?.trialEligiblePlanIds ?? [];

  // Bank transfer (Havale / EFT) is the only payment rail for non-TRY
  // plans — PayTR card checkout is TRY-only. If a superadmin hasn't
  // enabled the channel, a foreign-currency plan has no working payment
  // path, so we mark its CTA as a dead-end guard (read-only signal).
  const { data: bankTransfer } = useBankTransferDetails();
  const havaleEnabled = bankTransfer?.enabled ?? false;

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
    // Skeleton placeholders match the eventual 3-column grid so the
    // layout doesn't jump when plans arrive.
    return (
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 h-10 w-72 animate-pulse rounded bg-[#ece2d4]" />
          <div className="mx-auto h-5 w-96 animate-pulse rounded bg-[#f1e8db]" />
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <PlanCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-[#78716c]">{t('subscriptions.plansPage.noPlans')}</p>
      </div>
    );
  }

  // Sort plans by price
  const sortedPlans = [...plans].sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  const previousPlanName = currentSubscription?.plan?.displayName;
  const display = { fontFamily: '"Fraunces", Georgia, serif' } as const;

  return (
    <div className="mx-auto max-w-6xl px-1 pb-12">
      {/* Onboarding-trial lock banner: the tenant's 7-day trial ended and they
          are locked to this screen until they activate a paid plan. */}
      {currentSubscription?.status === 'TRIAL_ENDED' && (
        <div className="mb-8 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900">
          <h3 className="mb-1 font-semibold">
            {t(
              'subscriptions.plansPage.trialEndedTitle',
              'Deneme süreniz sona erdi',
            )}
          </h3>
          <p className="text-sm">
            {t(
              'subscriptions.plansPage.trialEndedBody',
              'Kullanmaya devam etmek için aşağıdaki paketlerden birini seçin. Verileriniz güvende; bir plan etkinleştirdiğinizde kaldığınız yerden devam edersiniz.',
            )}
          </p>
        </div>
      )}
      {/* Renewal banner: surfaces when the user arrives from a PAST_DUE
          or EXPIRED CTA. Reminds them what plan they were on and gives
          permission to pick a different one. */}
      {isRenewFlow && (
        <div className="mb-8 rounded-2xl border border-[#f5c9a3] bg-[#fff3e8] p-5 text-[#b45309]">
          <h3 className="mb-1 font-semibold">
            {t('subscriptions.plansPage.renewBannerTitle', 'Aboneliğinizi yenileyin')}
          </h3>
          <p className="text-sm">
            {previousPlanName
              ? t('subscriptions.plansPage.renewBannerWithPlan', {
                  plan: previousPlanName,
                  defaultValue: `Önceki paketiniz: ${previousPlanName}. Aynı planı seçerek yenileyebilir veya başka bir plana geçebilirsiniz.`,
                })
              : t(
                  'subscriptions.plansPage.renewBanner',
                  'Aboneliğinizi yenilemek için aşağıdan bir plan seçin.',
                )}
          </p>
        </div>
      )}

      {/* Warm hero header */}
      <div className="mb-12 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#f5c9a3] bg-[#fff3e8] px-3 py-1 text-xs font-semibold text-[#b45309]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#f97316]" /> {t('subscriptions.plansPage.heroBadge', 'Esnek planlar')}
        </span>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-[#1c1917] sm:text-5xl" style={display}>
          {t('subscriptions.plansPage.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-[#57534e]">
          {t('subscriptions.plansPage.subtitle')}
        </p>

        {/* Billing Cycle Toggle */}
        <div className="mt-8 inline-flex items-center rounded-xl border border-[#ece2d4] bg-white p-1 shadow-sm">
          <button
            onClick={() => setBillingCycle(BillingCycle.MONTHLY)}
            className={`rounded-lg px-6 py-2 text-sm font-semibold transition ${
              billingCycle === BillingCycle.MONTHLY
                ? 'bg-[#1c1917] text-white shadow-sm'
                : 'text-[#57534e] hover:text-[#1c1917]'
            }`}
          >
            {t('subscriptions.monthly')}
          </button>
          <button
            onClick={() => setBillingCycle(BillingCycle.YEARLY)}
            className={`flex items-center rounded-lg px-6 py-2 text-sm font-semibold transition ${
              billingCycle === BillingCycle.YEARLY
                ? 'bg-[#1c1917] text-white shadow-sm'
                : 'text-[#57534e] hover:text-[#1c1917]'
            }`}
          >
            {t('subscriptions.yearly')}
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                billingCycle === BillingCycle.YEARLY
                  ? 'bg-[#f97316] text-white'
                  : 'bg-[#fff3e8] text-[#b45309]'
              }`}
            >
              {t('subscriptions.savePercent', { percent: maxSavingsPercent })}
            </span>
          </button>
        </div>
        {/* Yearly savings transparency — show real numbers when yearly is
            selected; abstract "%17 tasarruf" rarely converts on its own. */}
        {billingCycle === BillingCycle.YEARLY && (
          <YearlySavingsHint plans={sortedPlans} />
        )}
      </div>

      {/* Plans Grid — 3 equal columns on lg, stacked on mobile. The
          BUSINESS card is elevated as the highlighted "En Popüler" tier. */}
      <div className="mb-12 grid grid-cols-1 items-start gap-6 md:grid-cols-3 lg:gap-8 lg:pt-3">
        {sortedPlans.map((plan) => {
          // A non-TRY plan with bank transfer disabled has no usable
          // payment path → guard the CTA so the user doesn't dead-end at
          // checkout. They can still read the card; only the select action
          // is blocked, with an explanatory hint.
          const isNonTry = (plan.currency || 'TRY') !== 'TRY';
          const noPaymentPath = isNonTry && !havaleEnabled;
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              billingCycle={billingCycle}
              isCurrentPlan={currentSubscription?.planId === plan.id}
              isPopular={plan.name === SubscriptionPlanType.BUSINESS}
              isTrialEligible={trialEligibleIds.includes(plan.id)}
              onSelectPlan={handleSelectPlan}
              isLoading={processingPlanId === plan.id}
              selectDisabledHint={
                noPaymentPath
                  ? t(
                      'subscriptions.plansPage.noPaymentMethodHint',
                      'Bu plan için ödeme yöntemi yapılandırılmamış',
                    )
                  : undefined
              }
            />
          );
        })}
      </div>

      {/* Current Subscription Info */}
      {currentSubscription && (
        <div className="rounded-2xl border border-[#ece2d4] bg-white p-6 shadow-sm shadow-stone-900/5">
          <div className="text-center">
            <h3 className="mb-2 font-semibold text-[#1c1917]">
              {t('subscriptions.plansPage.haveActiveSubscription')}
            </h3>
            <p className="mb-4 text-sm text-[#78716c]">
              {t('subscriptions.plansPage.toChangePlan')}
            </p>
            <button
              onClick={() => navigate('/admin/settings/subscription')}
              className="inline-flex items-center gap-2 rounded-xl bg-[#f97316] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ea580c]"
            >
              {t('subscriptions.plansPage.manageSubscription')}
            </button>
          </div>
        </div>
      )}

      {/* Plan comparison matrix — collapsed by default to keep the
          page scannable. Power users expand it for full feature parity. */}
      <PlanComparisonMatrix plans={sortedPlans} />

      {/* FAQ Section */}
      <div className="mt-16 border-t border-[#ece2d4] pt-12">
        <h2 className="mb-8 text-center text-2xl font-semibold tracking-tight text-[#1c1917] sm:text-3xl" style={display}>
          {t('subscriptions.plansPage.faqTitle')}
        </h2>
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-5 md:grid-cols-2">
          {[
            { q: 'faqChangePlans', a: 'faqChangePlansAnswer' },
            { q: 'faqPaymentMethods', a: 'faqPaymentMethodsAnswer' },
            { q: 'faqCancelAnytime', a: 'faqCancelAnytimeAnswer' },
            { q: 'faqFreeTrial', a: 'faqFreeTrialAnswer' },
          ].map((item) => (
            <div key={item.q} className="rounded-2xl border border-[#ece2d4] bg-white p-6 shadow-sm shadow-stone-900/5">
              <h3 className="mb-2 font-semibold text-[#1c1917]">{t(`subscriptions.plansPage.${item.q}`)}</h3>
              <p className="text-sm leading-relaxed text-[#78716c]">
                {t(`subscriptions.plansPage.${item.a}`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPlansPage;
