'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { Tilt3D } from '@/components/animations/Tilt3D';
import { GradientOrb } from '@/components/animations/FloatingElement';

export default function Pricing() {
  const t = useTranslations('pricing');
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

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
    <section ref={sectionRef} id="pricing" className="section-padding relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 to-white" />

      {/* Floating orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <GradientOrb
          color="rgba(249, 115, 22, 0.1)"
          size={400}
          blur={100}
          className="absolute -top-20 right-1/4"
          duration={12}
        />
        <GradientOrb
          color="rgba(59, 130, 246, 0.08)"
          size={350}
          blur={80}
          className="absolute bottom-20 left-1/4"
          duration={15}
          delay={4}
        />
      </div>

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
            className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider"
          >
            {t('badge')}
          </motion.span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-600">{t('subtitle')}</p>
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
                      ? 'shadow-2xl shadow-orange-500/20 border-2 border-orange-500'
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
                      <div className="flex items-center gap-1.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-sm font-semibold px-4 py-1.5 rounded-full shadow-lg">
                        <Sparkles className="w-4 h-4" />
                        {t('mostPopular')}
                      </div>
                    </motion.div>
                  )}

                  <div className="text-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900 mb-1">{plan.name}</h3>
                    <p className="text-sm text-slate-500">{plan.description}</p>
                  </div>

                  <div className="text-center mb-6">
                    <motion.span
                      initial={{ scale: 0.5 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + index * 0.1, type: 'spring' }}
                      className={`text-5xl font-bold ${plan.popular ? 'text-orange-600' : 'text-slate-900'}`}
                    >
                      {plan.price}
                    </motion.span>
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
                          <Check className={`w-5 h-5 flex-shrink-0 ${plan.popular ? 'text-orange-500' : 'text-green-500'}`} />
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
                        ? 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/30'
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
