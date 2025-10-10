import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import {
  useGetPlans,
  useGetCurrentSubscription,
  useCreateSubscription,
} from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../../components/subscriptions/PlanCard';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { BillingCycle, SubscriptionPlanType } from '../../types';

const SubscriptionPlansPage = () => {
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(BillingCycle.MONTHLY);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const { data: plans, isLoading: plansLoading } = useGetPlans();
  const { data: currentSubscription } = useGetCurrentSubscription();
  const createSubscription = useCreateSubscription();

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId);
  };

  const handleCreateSubscription = async () => {
    if (!selectedPlanId) return;

    try {
      const subscription = await createSubscription.mutateAsync({
        planId: selectedPlanId,
        billingCycle,
        // Payment provider is determined automatically by the backend based on tenant's region
      });
      // Redirect to payment page with subscription ID
      navigate(`/subscription/payment?subscriptionId=${subscription.id}`);
    } catch (error) {
      console.error('Failed to create subscription:', error);
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
        <p className="text-gray-600">No subscription plans available at the moment.</p>
      </div>
    );
  }

  // Sort plans by price
  const sortedPlans = [...plans].sort((a, b) => a.monthlyPrice - b.monthlyPrice);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Plan</h1>
        <p className="text-lg text-gray-600 mb-8">
          Select the perfect plan for your restaurant business
        </p>

        {/* Billing Cycle Toggle */}
        <div className="inline-flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setBillingCycle(BillingCycle.MONTHLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${
              billingCycle === BillingCycle.MONTHLY
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingCycle(BillingCycle.YEARLY)}
            className={`px-6 py-2 rounded-md font-medium transition-colors ${
              billingCycle === BillingCycle.YEARLY
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Yearly
            <span className="ml-2 text-xs bg-green-100 text-green-600 px-2 py-0.5 rounded-full">
              Save up to 20%
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
            isLoading={createSubscription.isPending && selectedPlanId === plan.id}
          />
        ))}
      </div>

      {/* Selected Plan Actions */}
      {selectedPlanId && !currentSubscription && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <CreditCard className="h-6 w-6 text-blue-600 mr-3" />
              <div>
                <h3 className="font-semibold text-gray-900">Ready to get started?</h3>
                <p className="text-sm text-gray-600">
                  You'll be redirected to payment after confirming
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setSelectedPlanId(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateSubscription}
                isLoading={createSubscription.isPending}
              >
                Proceed to Payment
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Current Subscription Info */}
      {currentSubscription && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="text-center">
            <h3 className="font-semibold text-gray-900 mb-2">
              You have an active subscription
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              To change your plan, visit the subscription management page
            </p>
            <Button variant="primary" onClick={() => navigate('/subscription/manage')}>
              Manage Subscription
            </Button>
          </div>
        </div>
      )}

      {/* FAQ Section */}
      <div className="mt-16 border-t pt-12">
        <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
          Frequently Asked Questions
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Can I change plans later?</h3>
            <p className="text-gray-600 text-sm">
              Yes, you can upgrade or downgrade your plan at any time from the subscription
              management page.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">What payment methods do you accept?</h3>
            <p className="text-gray-600 text-sm">
              We accept all major credit cards through Stripe and also support local payment
              methods via Iyzico.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Can I cancel anytime?</h3>
            <p className="text-gray-600 text-sm">
              Yes, you can cancel your subscription at any time. You'll continue to have access
              until the end of your billing period.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Is there a free trial?</h3>
            <p className="text-gray-600 text-sm">
              Yes, most paid plans include a 14-day free trial. You won't be charged until the
              trial period ends.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPlansPage;
