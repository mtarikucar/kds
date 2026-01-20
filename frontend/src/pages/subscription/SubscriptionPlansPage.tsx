import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  useGetPlans,
  useGetCurrentSubscription,
  useCreateSubscription,
} from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../../components/subscriptions/PlanCard';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { BillingCycle, SubscriptionPlanType, Plan } from '../../types';

const SubscriptionPlansPage = () => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading } = useGetPlans();
  const { data: currentSubscription } = useGetCurrentSubscription();
  const createSubscription = useCreateSubscription();

  // Handle plan selection - directly create subscription and navigate to payment
  const handleSelectPlan = async (planId: string) => {
    // Don't process if already processing or user has active subscription
    if (processingPlanId || currentSubscription) return;

    setProcessingPlanId(planId);
    try {
      const subscription = await createSubscription.mutateAsync({
        planId,
        billingCycle,
      });
      // Redirect to payment page with subscription ID
      navigate(`/subscription/payment?subscriptionId=${subscription.id}`);
    } catch (error) {
      console.error('Failed to create subscription:', error);
      setProcessingPlanId(null);
    }
  };

  if (plansLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!plans || plans.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">{t('subscriptions.plansPage.noPlans')}</p>
      </div>
    );
  }

  // Sort plans by price
  const sortedPlans = [...plans].sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  // Calculate max savings percentage for yearly billing
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

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{t('subscriptions.plansPage.title')}</h1>
        <p className="text-lg text-gray-600 mb-8">
          {t('subscriptions.plansPage.subtitle')}
        </p>

        {/* Billing Cycle Toggle */}
        <div className="inline-flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setBillingCycle(BillingCycle.MONTHLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${billingCycle === BillingCycle.MONTHLY
              ? 'bg-card text-primary-600 shadow-sm'
              : 'text-neutral-600 hover:text-foreground'
              }`}
          >
            {t('subscriptions.monthly')}
          </button>
          <button
            onClick={() => setBillingCycle(BillingCycle.YEARLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${billingCycle === BillingCycle.YEARLY
              ? 'bg-card text-primary-600 shadow-sm'
              : 'text-neutral-600 hover:text-foreground'
              }`}
          >
            {t('subscriptions.yearly')}
            <span className="ml-2 text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
              {t('subscriptions.savePercent', { percent: maxSavingsPercent })}
            </span>
          </button>
        </div>
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
            onSelectPlan={handleSelectPlan}
            isLoading={createSubscription.isPending && processingPlanId === plan.id}
          />
        ))}
      </div>

      {/* Current Subscription Info */}
      {currentSubscription && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="text-center">
            <h3 className="font-semibold text-gray-900 mb-2">
              {t('subscriptions.plansPage.haveActiveSubscription')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {t('subscriptions.plansPage.toChangePlan')}
            </p>
            <Button variant="primary" onClick={() => navigate('/admin/settings/subscription')}>
              {t('subscriptions.plansPage.manageSubscription')}
            </Button>
          </div>
        </div>
      )}

      {/* FAQ Section */}
      <div className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          {t('subscriptions.plansPage.faqTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">{t('subscriptions.plansPage.faqChangePlans')}</h3>
            <p className="text-gray-600 text-sm">
              {t('subscriptions.plansPage.faqChangePlansAnswer')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">{t('subscriptions.plansPage.faqPaymentMethods')}</h3>
            <p className="text-gray-600 text-sm">
              {t('subscriptions.plansPage.faqPaymentMethodsAnswer')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">{t('subscriptions.plansPage.faqCancelAnytime')}</h3>
            <p className="text-gray-600 text-sm">
              {t('subscriptions.plansPage.faqCancelAnytimeAnswer')}
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">{t('subscriptions.plansPage.faqFreeTrial')}</h3>
            <p className="text-gray-600 text-sm">
              {t('subscriptions.plansPage.faqFreeTrialAnswer')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPlansPage;
