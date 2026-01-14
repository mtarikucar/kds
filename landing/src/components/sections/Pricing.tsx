'use client';

import { motion } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Check, ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function Pricing() {
  const t = useTranslations('pricing');

  const plans = [
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
    },
  ];

  return (
    <section id="pricing" className="section-padding">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <span className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider">
            {t('badge')}
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-600">
            {t('subtitle')}
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.key}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`relative bg-white rounded-2xl p-8 ${
                plan.popular
                  ? 'shadow-2xl shadow-slate-200/50 border-2 border-slate-900 scale-105'
                  : 'shadow-lg shadow-slate-200/50 border border-slate-200'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm font-semibold px-4 py-1 rounded-full">
                  {t('mostPopular')}
                </div>
              )}

              <div className="text-center mb-6">
                <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.name}</h3>
                <p className="text-sm text-slate-500">{plan.description}</p>
              </div>

              <div className="text-center mb-6">
                <span className="text-5xl font-bold text-slate-900">{plan.price}</span>
                <span className="text-slate-500">{plan.period}</span>
              </div>

              <ul className="space-y-3 mb-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm">
                    <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
                    <span className="text-slate-600">{feature}</span>
                  </li>
                ))}
              </ul>

              <a
                href={plan.href}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${
                  plan.popular
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                }`}
              >
                {plan.cta}
                <ArrowRight className="w-4 h-4" />
              </a>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center text-sm text-slate-500 mt-12"
        >
          {t('trialNote')}
        </motion.p>
      </Container>
    </section>
  );
}
