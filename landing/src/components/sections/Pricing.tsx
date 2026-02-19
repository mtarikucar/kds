'use client';

import { useRef, useState, useEffect } from 'react';
import { motion, useScroll } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Check, ArrowRight, Sparkles, Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Tilt3D } from '@/components/animations/Tilt3D';
import { GradientOrb } from '@/components/animations/FloatingElement';
import { RamadanDecorSet } from '@/components/animations/RamadanDecorations';
import CountdownTimer from '@/components/ui/CountdownTimer';
import { type PlanFromAPI } from '@/lib/api';

interface PricingProps {
  apiPlans?: PlanFromAPI[];
}

export default function Pricing({ apiPlans }: PricingProps) {
  const t = useTranslations('pricing');
  const tRamadan = useTranslations('ramadan');
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  // Check if any API plan has an active discount
  const activeDiscount = apiPlans?.find(
    (p) => p.isDiscountActive && p.discountPercentage && p.discountEndDate && new Date(p.discountEndDate) > new Date()
  );

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

  // Map API plans to overlay discount info on static plans
  const plans = staticPlans.map((sp) => {
    const apiPlan = apiPlans?.find(
      (ap) => ap.name.toLowerCase() === sp.key.toLowerCase()
    );
    const hasDiscount = apiPlan?.isDiscountActive && apiPlan?.discountPercentage &&
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
      {/* Ramadan themed background */}
      <div className="absolute inset-0 bg-gradient-to-b from-ramadan-deep/[0.03] via-white to-ramadan-deep/[0.05]" />

      {/* Floating orbs - Ramadan colors */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <GradientOrb
          color="rgba(212, 160, 23, 0.08)"
          size={400}
          blur={100}
          className="absolute -top-20 right-1/4"
          duration={12}
        />
        <GradientOrb
          color="rgba(107, 33, 168, 0.06)"
          size={350}
          blur={80}
          className="absolute bottom-20 left-1/4"
          duration={15}
          delay={4}
        />
      </div>

      {/* Ramadan decorations */}
      <RamadanDecorSet variant="pricing" />

      <Container className="relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-block text-sm font-semibold text-ramadan-gold mb-4 uppercase tracking-wider"
          >
            {t('badge')}
          </motion.span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-600">{t('subtitle')}</p>

          {/* Countdown Timer for active discount */}
          {activeDiscount?.discountEndDate && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="mt-6 flex justify-center"
            >
              <CountdownTimer targetDate={activeDiscount.discountEndDate} variant="light" />
            </motion.div>
          )}
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <motion.div
              key={plan.key}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={plan.popular ? 'lg:-mt-4 lg:mb-4' : ''}
            >
              <Tilt3D
                maxRotation={plan.popular ? 8 : 5}
                perspective={1000}
                scale={plan.popular ? 1.03 : 1.02}
                glare={plan.popular}
              >
                <div
                  className={`
                    relative h-full bg-white rounded-3xl p-8
                    ${plan.popular
                      ? 'shadow-2xl shadow-ramadan-gold/20 border-2 border-ramadan-gold'
                      : 'shadow-xl shadow-slate-200/50 border border-slate-200'}
                  `}
                >
                  {/* Popular badge */}
                  {plan.popular && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute -top-4 left-1/2 -translate-x-1/2"
                    >
                      <div className="flex items-center gap-1.5 bg-gradient-to-r from-ramadan-gold to-ramadan-star text-ramadan-deep text-sm font-semibold px-4 py-1.5 rounded-full shadow-lg">
                        <Sparkles className="w-4 h-4" />
                        {t('mostPopular')}
                      </div>
                    </motion.div>
                  )}

                  {/* Discount badge */}
                  {plan.discountPercentage && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.8 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      className="mb-3"
                    >
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-ramadan-gold/10 text-ramadan-gold border border-ramadan-gold/20 rounded-full">
                        <Tag className="w-3 h-3" />
                        {tRamadan('discountBadge', { percent: plan.discountPercentage })}
                      </span>
                    </motion.div>
                  )}

                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.name}</h3>
                    <p className="text-sm text-slate-500">{plan.description}</p>
                  </div>

                  <div className="text-center mb-6">
                    {plan.discountedPrice ? (
                      <>
                        <span className="text-xl text-slate-400 line-through mr-2">{plan.price}</span>
                        <motion.span
                          initial={{ scale: 0.5 }}
                          whileInView={{ scale: 1 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.3 + index * 0.1, type: 'spring' }}
                          className="text-5xl font-bold text-ramadan-gold"
                        >
                          {plan.discountedPrice}
                        </motion.span>
                      </>
                    ) : (
                      <motion.span
                        initial={{ scale: 0.5 }}
                        whileInView={{ scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 + index * 0.1, type: 'spring' }}
                        className={`text-5xl font-bold ${plan.popular ? 'text-ramadan-gold' : 'text-slate-900'}`}
                      >
                        {plan.price}
                      </motion.span>
                    )}
                    <span className="text-slate-500">{plan.period}</span>
                  </div>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, i) => (
                      <motion.li
                        key={feature}
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.4 + i * 0.05 }}
                        className="flex items-center gap-3 text-sm"
                      >
                        <motion.div
                          initial={prefersReducedMotion ? {} : { scale: 0 }}
                          whileInView={{ scale: 1 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.5 + i * 0.05, type: 'spring' }}
                        >
                          <Check className={`w-5 h-5 flex-shrink-0 ${plan.popular ? 'text-ramadan-gold' : 'text-green-500'}`} />
                        </motion.div>
                        <span className="text-slate-600">{feature}</span>
                      </motion.li>
                    ))}
                  </ul>

                  <motion.a
                    href={plan.href}
                    whileHover={prefersReducedMotion ? {} : { scale: 1.02, y: -2 }}
                    whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                    className={`
                      w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-semibold transition-all
                      ${plan.popular
                        ? 'bg-gradient-to-r from-ramadan-gold to-ramadan-star text-ramadan-deep shadow-lg shadow-ramadan-gold/25 hover:shadow-xl hover:shadow-ramadan-gold/30'
                        : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}
                    `}
                  >
                    {plan.cta}
                    <ArrowRight className="w-4 h-4" />
                  </motion.a>
                </div>
              </Tilt3D>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="text-center text-sm text-slate-500 mt-12"
        >
          {t('trialNote')}
        </motion.p>
      </Container>
    </section>
  );
}
