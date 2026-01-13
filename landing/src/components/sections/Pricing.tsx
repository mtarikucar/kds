'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Star, ChevronDown, ChevronUp } from 'lucide-react';

// Static pricing data - will be replaced with API data later
const plans = [
  {
    id: 'FREE',
    name: 'FREE',
    monthlyPrice: 0,
    yearlyPrice: 0,
    limits: { users: 2, tables: 5, products: 20, orders: 100 },
    features: ['pos', 'kitchen', 'tables'],
    popular: false,
  },
  {
    id: 'BASIC',
    name: 'BASIC',
    monthlyPrice: 299,
    yearlyPrice: 2390,
    limits: { users: 5, tables: 15, products: 100, orders: 500 },
    features: ['pos', 'kitchen', 'tables', 'analytics'],
    popular: false,
  },
  {
    id: 'PRO',
    name: 'PRO',
    monthlyPrice: 599,
    yearlyPrice: 4790,
    limits: { users: 15, tables: 50, products: 500, orders: 2000 },
    features: ['pos', 'kitchen', 'tables', 'analytics', 'multiLocation'],
    popular: true,
  },
  {
    id: 'BUSINESS',
    name: 'BUSINESS',
    monthlyPrice: 999,
    yearlyPrice: 7990,
    limits: { users: -1, tables: -1, products: -1, orders: -1 },
    features: [
      'pos',
      'kitchen',
      'tables',
      'analytics',
      'multiLocation',
      'api',
      'priority',
    ],
    popular: false,
  },
];

const faqs = ['q1', 'q2', 'q3', 'q4'];

export default function Pricing() {
  const t = useTranslations('pricing');
  const pt = useTranslations('plans');
  const [isYearly, setIsYearly] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const formatLimit = (value: number, unit: string) => {
    if (value === -1) return t('unlimited');
    return `${value} ${t(unit)}`;
  };

  return (
    <section id="pricing" className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-gray-600">{t('subtitle')}</p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center gap-4 mb-12">
          <span
            className={`font-medium ${!isYearly ? 'text-gray-900' : 'text-gray-500'}`}
          >
            {t('monthly')}
          </span>
          <button
            onClick={() => setIsYearly(!isYearly)}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              isYearly ? 'bg-orange-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                isYearly ? 'translate-x-8' : 'translate-x-1'
              }`}
            />
          </button>
          <span
            className={`font-medium flex items-center gap-2 ${isYearly ? 'text-gray-900' : 'text-gray-500'}`}
          >
            {t('yearly')}
            <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded-full">
              {t('save20')}
            </span>
          </span>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {plans.map((plan) => {
            const price = isYearly ? plan.yearlyPrice : plan.monthlyPrice;

            return (
              <div
                key={plan.id}
                className={`relative bg-white rounded-2xl p-6 border-2 transition-all hover:shadow-lg ${
                  plan.popular
                    ? 'border-orange-500 shadow-lg'
                    : 'border-gray-100'
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
                    <Star size={12} fill="currentColor" />
                    {t('mostPopular')}
                  </div>
                )}

                <div className="text-center mb-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {pt(`${plan.name}.name`)}
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    {pt(`${plan.name}.description`)}
                  </p>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-4xl font-bold text-gray-900">
                      {formatPrice(price)}
                    </span>
                    <span className="text-gray-500">
                      {isYearly ? t('perYear') : t('perMonth')}
                    </span>
                  </div>
                </div>

                <ul className="space-y-3 mb-6">
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check size={16} className="text-green-500 flex-shrink-0" />
                    {formatLimit(plan.limits.users, 'users')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check size={16} className="text-green-500 flex-shrink-0" />
                    {formatLimit(plan.limits.tables, 'tables')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check size={16} className="text-green-500 flex-shrink-0" />
                    {formatLimit(plan.limits.products, 'products')}
                  </li>
                  <li className="flex items-center gap-2 text-sm text-gray-600">
                    <Check size={16} className="text-green-500 flex-shrink-0" />
                    {formatLimit(plan.limits.orders, 'orders')}
                  </li>
                </ul>

                <a
                  href={`/app/register?plan=${plan.id}`}
                  className={`block text-center py-3 rounded-xl font-semibold transition-colors ${
                    plan.popular
                      ? 'bg-orange-500 hover:bg-orange-600 text-white'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-900'
                  }`}
                >
                  {t('getStarted')}
                </a>
              </div>
            );
          })}
        </div>

        {/* FAQ Section */}
        <div className="max-w-3xl mx-auto">
          <h3 className="text-2xl font-bold text-gray-900 text-center mb-8">
            {t('faq.title')}
          </h3>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={faq}
                className="bg-white rounded-xl border border-gray-200 overflow-hidden"
              >
                <button
                  onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  className="w-full flex items-center justify-between p-4 text-left font-medium text-gray-900 hover:bg-gray-50"
                >
                  {t(`faq.${faq}`)}
                  {openFaq === index ? (
                    <ChevronUp size={20} className="text-gray-500" />
                  ) : (
                    <ChevronDown size={20} className="text-gray-500" />
                  )}
                </button>
                {openFaq === index && (
                  <div className="px-4 pb-4 text-gray-600">
                    {t(`faq.a${index + 1}`)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
