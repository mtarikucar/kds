'use client';

import { useState, useEffect } from 'react';
import { Container } from '@/components/ui/Container';
import { Check, ArrowRight, Sparkles, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { type PlanFromAPI } from '@/lib/api';

interface PricingProps {
  apiPlans?: PlanFromAPI[];
}

export default function Pricing({ apiPlans }: PricingProps) {
  const t = useTranslations('pricing');
  const sectionRef = useScrollReveal<HTMLElement>();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Build plans from translations (static) with optional API discount overlay
  const staticPlans = [
    {
      key: 'free',
      name: t('plans.free.name'),
      description: t('plans.free.description'),
      price: t('plans.free.price'),
      period: t('perMonth'),
      features: t.raw('plans.free.features') as string[],
      cta: t('plans.free.cta'),
      href: '/app/register?plan=FREE',
      popular: false,
      monthlyPrice: 0,
    },
    {
      key: 'basic',
      name: t('plans.basic.name'),
      description: t('plans.basic.description'),
      price: t('plans.basic.price'),
      period: t('perMonth'),
      features: t.raw('plans.basic.features') as string[],
      cta: t('plans.basic.cta'),
      href: '/app/register?plan=BASIC',
      popular: false,
      monthlyPrice: 29.99,
    },
    {
      key: 'pro',
      name: t('plans.pro.name'),
      description: t('plans.pro.description'),
      price: t('plans.pro.price'),
      period: t('perMonth'),
      features: t.raw('plans.pro.features') as string[],
      cta: t('plans.pro.cta'),
      href: '/app/register?plan=PRO',
      popular: true,
      monthlyPrice: 79.99,
    },
    {
      key: 'business',
      name: t('plans.business.name'),
      description: t('plans.business.description'),
      price: t('plans.business.price'),
      period: t('perMonth'),
      features: t.raw('plans.business.features') as string[],
      cta: t('plans.business.cta'),
      href: '/app/register?plan=BUSINESS',
      popular: false,
      monthlyPrice: 199.99,
    },
  ];

  // Map API plans to overlay discount info
  const plans = staticPlans.map((sp) => {
    const apiPlan = apiPlans?.find(
      (ap) => ap.name.toLowerCase() === sp.key.toLowerCase()
    );
    const hasDiscount = mounted && apiPlan?.isDiscountActive && apiPlan?.discountPercentage &&
      apiPlan?.discountEndDate && new Date(apiPlan.discountEndDate) > new Date();

    return {
      ...sp,
      discountPercentage: hasDiscount ? apiPlan!.discountPercentage : undefined,
      discountLabel: hasDiscount ? apiPlan!.discountLabel : undefined,
      discountEndDate: hasDiscount ? apiPlan!.discountEndDate : undefined,
      discountedPrice: hasDiscount && sp.monthlyPrice > 0
        ? `$${(sp.monthlyPrice * (1 - apiPlan!.discountPercentage! / 100)).toFixed(2)}`
        : undefined,
    };
  });

  return (
    <section ref={sectionRef} id="pricing" className="section-padding relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-slate-50" />

      {/* Gradient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="gradient-orb"
          style={{
            top: '-80px',
            right: '25%',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(249, 115, 22, 0.08) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
        />
        <div
          className="gradient-orb"
          style={{
            bottom: '80px',
            left: '25%',
            width: '350px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(107, 33, 168, 0.06) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      <Container className="relative">
        <div data-animate="slide-up" className="text-center max-w-3xl mx-auto mb-16">
          <span className="inline-block text-sm font-semibold text-orange-500 mb-4 uppercase tracking-wider">
            {t('badge')}
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-600">{t('subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <div
              key={plan.key}
              data-animate="slide-up"
              style={{ '--delay': `${index * 0.1}s` } as React.CSSProperties}
              className={plan.popular ? 'lg:-mt-4 lg:mb-4' : ''}
            >
              <div className={plan.popular ? 'hover-tilt-strong' : 'hover-tilt'}>
                <div
                  className={`
                    relative h-full bg-white rounded-3xl p-8
                    ${plan.popular
                      ? 'shadow-2xl shadow-orange-500/20 border-2 border-orange-500'
                      : 'shadow-xl shadow-slate-200/50 border border-slate-200'}
                  `}
                >
                  {/* Popular badge */}
                  {plan.popular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <div className="flex items-center gap-1.5 bg-gradient-to-r from-orange-500 to-amber-500 text-slate-900 text-sm font-semibold px-4 py-1.5 rounded-full shadow-lg">
                        <Sparkles className="w-4 h-4" />
                        {t('mostPopular')}
                      </div>
                    </div>
                  )}

                  {/* Discount badge */}
                  {plan.discountPercentage && (
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-orange-500/10 text-orange-500 border border-orange-500/20 rounded-full">
                        <Tag className="w-3 h-3" />
                        {plan.discountPercentage}% OFF
                      </span>
                    </div>
                  )}

                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.name}</h3>
                    <p className="text-sm text-slate-500">{plan.description}</p>
                  </div>

                  <div className="text-center mb-6">
                    {plan.discountedPrice ? (
                      <>
                        <span className="text-xl text-slate-400 line-through mr-2">{plan.price}</span>
                        <span className="text-5xl font-bold text-orange-500 animate-scale-in">
                          {plan.discountedPrice}
                        </span>
                      </>
                    ) : (
                      <span className={`text-5xl font-bold ${plan.popular ? 'text-orange-500' : 'text-slate-900'}`}>
                        {plan.price}
                      </span>
                    )}
                    <span className="text-slate-500">{plan.period}</span>
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <li
                        key={feature}
                        className="flex items-center gap-3 text-sm"
                      >
                        <Check className={`w-5 h-5 flex-shrink-0 ${plan.popular ? 'text-orange-500' : 'text-green-500'}`} />
                        <span className="text-slate-600">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <a
                    href={plan.href}
                    className={`
                      hover-lift w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold transition-all
                      ${plan.popular
                        ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-slate-900 shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/30'
                        : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}
                    `}
                  >
                    {plan.cta}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p
          data-animate="fade"
          style={{ '--delay': '0.6s' } as React.CSSProperties}
          className="text-center text-sm text-slate-500 mt-12"
        >
          {t('trialNote')}
        </p>
      </Container>
    </section>
  );
}
