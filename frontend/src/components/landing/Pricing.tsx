import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGetPlans } from '../../features/subscriptions/subscriptionsApi';
import PlanCard from '../subscriptions/PlanCard';
import Spinner from '../ui/Spinner';

export const Pricing = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('common');
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');
  const { data: plans, isLoading } = useGetPlans();

  const handleSelectPlan = (planId: string) => {
    // Redirect to register with plan info
    navigate(`/register?plan=${planId}&billing=${billingCycle}`);
  };

  if (isLoading) {
    return (
      <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8 bg-background">
        <div className="max-w-7xl mx-auto text-center">
          <Spinner />
        </div>
      </section>
    );
  }

  const activePlans = plans?.filter((plan) => plan.isActive) || [];

  return (
    <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-br from-warm-beige via-warm-cream to-warm-tan relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-warm-orange/20 rounded-full blur-[120px]" />
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-primary-200/30 rounded-full blur-[120px]" />

      <div className="max-w-7xl mx-auto relative z-10">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-heading font-bold text-warm-dark mb-6">
            {t('pricing.title')}
          </h2>
          <p className="text-xl text-warm-brown/70 max-w-2xl mx-auto mb-10">
            {t('pricing.description')}
          </p>

          {/* Billing Cycle Toggle */}
          <div className="inline-flex items-center bg-white/70 p-1.5 rounded-full shadow-lg border-2 border-warm-orange/20 backdrop-blur-sm">
            <button
              onClick={() => setBillingCycle('MONTHLY')}
              className={`px-8 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${billingCycle === 'MONTHLY'
                  ? 'bg-warm-orange text-white shadow-md'
                  : 'text-warm-brown/60 hover:text-warm-dark'
                }`}
            >
              {t('pricing.monthly')}
            </button>
            <button
              onClick={() => setBillingCycle('YEARLY')}
              className={`px-8 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${billingCycle === 'YEARLY'
                  ? 'bg-warm-orange text-white shadow-md'
                  : 'text-warm-brown/60 hover:text-warm-dark'
                }`}
            >
              {t('pricing.yearly')}
              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">
                -20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-20">
          {activePlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              billingCycle={billingCycle}
              onSelect={() => handleSelectPlan(plan.id)}
              buttonText={t('pricing.getStarted')}
            />
          ))}
        </div>

        {/* FAQ Section */}
        <div className="mt-24 max-w-3xl mx-auto">
          <h3 className="text-3xl font-heading font-bold text-warm-dark text-center mb-12">
            {t('pricing.faq')}
          </h3>
          <div className="space-y-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white/80 p-8 rounded-3xl border-2 border-warm-orange/20 shadow-lg hover:shadow-xl hover:border-warm-orange/40 transition-all backdrop-blur-sm">
                <h4 className="font-bold text-lg text-warm-dark mb-3">{t(`pricing.faqQ${i}`)}</h4>
                <p className="text-warm-brown/70 leading-relaxed">
                  {t(`pricing.faqA${i}`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
