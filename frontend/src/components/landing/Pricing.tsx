import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGetPlans } from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../subscriptions/PlanCard';
import Spinner from '../ui/Spinner';

export const Pricing = () => {
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const { data: plans, isLoading } = useGetPlans();

  const handleSelectPlan = (planId: string) => {
    // Redirect to register with plan info
    navigate(`/register?plan=${planId}&billing=${billingCycle}`);
  };

  if (isLoading) {
    return (
      <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-white">
        <div className="max-w-7xl mx-auto text-center">
          <Spinner />
        </div>
      </section>
    );
  }

  const activePlans = plans?.filter((plan) => plan.isActive) || [];

  return (
    <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-gray-50 to-white">
      <div className="max-w-7xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            Simple, Transparent Pricing
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-8">
            Choose the perfect plan for your restaurant. All plans include a free trial.
          </p>

          {/* Billing Cycle Toggle */}
          <div className="inline-flex items-center bg-white rounded-full p-1 shadow-md">
            <button
              onClick={() => setBillingCycle('MONTHLY')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'MONTHLY'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('YEARLY')}
              className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                billingCycle === 'YEARLY'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Yearly
              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          {activePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              billingCycle={billingCycle}
              onSelect={() => handleSelectPlan(plan.id)}
              buttonText="Get Started"
            />
          ))}
        </div>

        {/* FAQ Section */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h3 className="text-2xl font-bold text-gray-900 text-center mb-8">
            Frequently Asked Questions
          </h3>
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">How does the free trial work?</h4>
              <p className="text-gray-600">
                All plans include a 14-day free trial. No credit card required to start. You can cancel anytime during the trial period.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">Can I change plans later?</h4>
              <p className="text-gray-600">
                Yes! You can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">What payment methods do you accept?</h4>
              <p className="text-gray-600">
                We accept all major credit cards, debit cards, and support both international (Stripe) and Turkish (Iyzico) payment methods.
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm">
              <h4 className="font-semibold text-gray-900 mb-2">Is my data secure?</h4>
              <p className="text-gray-600">
                Absolutely. We use industry-standard encryption and security practices to keep your data safe. Your information is never shared with third parties.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
