import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import {
  useGetCurrentSubscription,
  useGetPlans,
  useChangePlan,
  useGetScheduledDowngrade,
} from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../../components/subscriptions/PlanCard';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import Modal from '../../components/ui/Modal';
import { BillingCycle, Plan, SubscriptionPlanType } from '../../types';
import { formatCurrency } from '../../lib/currency';

const ChangePlanPage = () => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();

  const [billingCycle, setBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const { data: currentSubscription, isLoading: subLoading } = useGetCurrentSubscription();
  const { data: plans, isLoading: plansLoading } = useGetPlans();
  const changePlan = useChangePlan();

  // Fetch scheduled downgrade
  const { data: scheduledDowngrade } = useGetScheduledDowngrade(
    currentSubscription?.id || ''
  );

  // Initialize billing cycle from current subscription
  useEffect(() => {
    if (currentSubscription?.billingCycle) {
      setBillingCycle(currentSubscription.billingCycle);
    }
  }, [currentSubscription?.billingCycle]);

  // Calculate savings percentage for each plan
  const calculateSavingsPercent = (plan: Plan): number => {
    const monthlyTotal = Number(plan.monthlyPrice) * 12;
    const yearlyTotal = Number(plan.yearlyPrice);
    if (monthlyTotal === 0) return 0;
    return Math.round(((monthlyTotal - yearlyTotal) / monthlyTotal) * 100);
  };

  // Calculate average/max savings for toggle badge
  const maxSavingsPercent = useMemo(() => {
    if (!plans) return 20;
    const paidPlans = plans.filter((p) => Number(p.monthlyPrice) > 0);
    if (paidPlans.length === 0) return 20;
    const savings = paidPlans.map((p) => calculateSavingsPercent(p));
    return Math.max(...savings);
  }, [plans]);

  // Sort plans by price
  const sortedPlans = useMemo(() => {
    if (!plans) return [];
    return [...plans].sort((a, b) => Number(a.monthlyPrice) - Number(b.monthlyPrice));
  }, [plans]);

  // Determine if selected plan is upgrade or downgrade
  const getChangeType = (newPlan: Plan): 'upgrade' | 'downgrade' => {
    if (!currentSubscription) return 'upgrade';
    const currentPrice = Number(currentSubscription.amount);
    const newPrice =
      billingCycle === BillingCycle.MONTHLY
        ? Number(newPlan.monthlyPrice)
        : Number(newPlan.yearlyPrice);
    return newPrice > currentPrice ? 'upgrade' : 'downgrade';
  };

  const handleSelectPlan = (planId: string) => {
    const plan = plans?.find((p) => p.id === planId);
    if (plan && plan.id !== currentSubscription?.planId) {
      setSelectedPlan(plan);
      setShowConfirmModal(true);
    }
  };

  const handleConfirmChange = async () => {
    if (!currentSubscription || !selectedPlan) return;

    try {
      const result = await changePlan.mutateAsync({
        id: currentSubscription.id,
        data: {
          newPlanId: selectedPlan.id,
          billingCycle,
        },
      });

      setShowConfirmModal(false);
      setSelectedPlan(null);

      if (result.type === 'upgrade' && result.requiresPayment && result.paymentInfo) {
        const { subscriptionId, newPlanId, billingCycle: cycle, prorationAmount, currency } = result.paymentInfo;
        navigate(
          `/subscription/payment?type=upgrade&subscriptionId=${subscriptionId}&newPlanId=${newPlanId}&billingCycle=${cycle}&amount=${prorationAmount}&currency=${currency}`
        );
      } else if (result.type === 'downgrade') {
        // Downgrade scheduled - go back to settings
        navigate('/admin/settings/subscription');
      }
    } catch (error) {
      console.error('Failed to change plan:', error);
    }
  };

  if (subLoading || plansLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!currentSubscription) {
    navigate('/subscription/plans');
    return null;
  }

  const currentPlan = plans?.find((p) => p.id === currentSubscription.planId);
  const changeType = selectedPlan ? getChangeType(selectedPlan) : null;

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/admin/settings/subscription')}
          className="flex items-center text-muted-foreground hover:text-foreground mb-4 transition-colors duration-200"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('subscriptions.backToSubscription')}
        </button>
        <h1 className="text-3xl font-bold font-heading text-foreground">{t('subscriptions.changePlanTitle')}</h1>
        <p className="text-gray-600 mt-2">
          {t('subscriptions.currentPlanLabel')}: <span className="font-semibold">{currentPlan?.displayName}</span>
        </p>
      </div>

      {/* Scheduled Downgrade Warning */}
      {scheduledDowngrade && (
        <div className="mb-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start">
          <AlertTriangle className="h-5 w-5 text-yellow-600 mr-3 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">{t('subscriptions.scheduledDowngradeWarning')}</p>
            <p className="text-sm text-yellow-700 mt-1">
              {t('subscriptions.scheduledDowngradeInfo', {
                plan: scheduledDowngrade.scheduledPlan?.displayName,
                date: new Date(scheduledDowngrade.scheduledFor).toLocaleDateString(),
              })}
            </p>
          </div>
        </div>
      )}

      {/* Billing Cycle Toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setBillingCycle(BillingCycle.MONTHLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${
              billingCycle === BillingCycle.MONTHLY
                ? 'bg-card text-primary-600 shadow-sm'
                : 'text-neutral-600 hover:text-foreground'
            }`}
          >
            {t('subscriptions.monthly')}
          </button>
          <button
            onClick={() => setBillingCycle(BillingCycle.YEARLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${
              billingCycle === BillingCycle.YEARLY
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {sortedPlans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            billingCycle={billingCycle}
            isCurrentPlan={currentSubscription.planId === plan.id}
            isPopular={plan.name === SubscriptionPlanType.PRO}
            onSelectPlan={handleSelectPlan}
            isLoading={changePlan.isPending && selectedPlan?.id === plan.id}
            buttonText={
              currentSubscription.planId === plan.id
                ? t('pricing.currentPlan')
                : Number(plan.monthlyPrice) > Number(currentPlan?.monthlyPrice || 0)
                ? t('subscriptions.upgrade')
                : t('subscriptions.downgrade')
            }
          />
        ))}
      </div>

      {/* Confirm Modal */}
      <Modal
        isOpen={showConfirmModal}
        onClose={() => {
          setShowConfirmModal(false);
          setSelectedPlan(null);
        }}
        title={
          changeType === 'upgrade'
            ? t('subscriptions.confirmUpgradeTitle')
            : t('subscriptions.confirmDowngradeTitle')
        }
      >
        <div className="space-y-4">
          {/* Change type indicator */}
          <div
            className={`flex items-center p-4 rounded-lg ${
              changeType === 'upgrade' ? 'bg-green-50' : 'bg-orange-50'
            }`}
          >
            {changeType === 'upgrade' ? (
              <TrendingUp className="h-6 w-6 text-green-600 mr-3" />
            ) : (
              <TrendingDown className="h-6 w-6 text-orange-600 mr-3" />
            )}
            <div>
              <p className="font-medium text-foreground">
                {currentPlan?.displayName} → {selectedPlan?.displayName}
              </p>
              <p className="text-sm text-gray-600">
                {formatCurrency(
                  billingCycle === BillingCycle.MONTHLY
                    ? Number(selectedPlan?.monthlyPrice || 0)
                    : Number(selectedPlan?.yearlyPrice || 0),
                  selectedPlan?.currency || 'TRY'
                )}
                /{billingCycle === BillingCycle.MONTHLY ? t('subscriptions.month') : t('subscriptions.year')}
              </p>
            </div>
          </div>

          {/* Upgrade message */}
          {changeType === 'upgrade' && (
            <p className="text-gray-600">{t('subscriptions.upgradeMessage')}</p>
          )}

          {/* Downgrade message */}
          {changeType === 'downgrade' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800">{t('subscriptions.downgradeMessage')}</p>
              <p className="text-sm text-yellow-700 mt-2">
                {t('subscriptions.downgradeEffectiveDate', {
                  date: new Date(currentSubscription.currentPeriodEnd).toLocaleDateString(),
                })}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowConfirmModal(false);
                setSelectedPlan(null);
              }}
            >
              {t('common:app.cancel')}
            </Button>
            <Button
              variant={changeType === 'upgrade' ? 'primary' : 'secondary'}
              onClick={handleConfirmChange}
              isLoading={changePlan.isPending}
            >
              {changeType === 'upgrade'
                ? t('subscriptions.confirmUpgrade')
                : t('subscriptions.confirmDowngrade')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ChangePlanPage;
