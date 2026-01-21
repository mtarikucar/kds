'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Clock, CheckCircle, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { AnimatedCounter } from '@/components/animations/AnimatedCounter';
import { GradientOrb } from '@/components/animations/FloatingElement';
import { Tilt3D } from '@/components/animations/Tilt3D';

export default function BusinessValue() {
  const t = useTranslations('business');
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  const backgroundY = useTransform(scrollYProgress, [0, 1], [0, -50]);

  const values = [
    {
      key: 'time',
      icon: Clock,
      title: t('values.time.title'),
      metric: 50,
      metricLabel: t('values.time.metricLabel'),
      description: t('values.time.description'),
      color: 'blue',
      suffix: '%',
    },
    {
      key: 'errors',
      icon: CheckCircle,
      title: t('values.errors.title'),
      metric: 85,
      metricLabel: t('values.errors.metricLabel'),
      description: t('values.errors.description'),
      color: 'green',
      suffix: '%',
    },
    {
      key: 'revenue',
      icon: TrendingUp,
      title: t('values.revenue.title'),
      metric: 25,
      metricLabel: t('values.revenue.metricLabel'),
      description: t('values.revenue.description'),
      color: 'orange',
      prefix: '+',
      suffix: '%',
    },
  ];

  const colorMap: Record<string, { bg: string; glow: string; gradient: string }> = {
    blue: {
      bg: 'bg-blue-500',
      glow: 'shadow-blue-500/30',
      gradient: 'from-blue-500/20 to-blue-600/10',
    },
    green: {
      bg: 'bg-green-500',
      glow: 'shadow-green-500/30',
      gradient: 'from-green-500/20 to-green-600/10',
    },
    orange: {
      bg: 'bg-orange-500',
      glow: 'shadow-orange-500/30',
      gradient: 'from-orange-500/20 to-orange-600/10',
    },
  };

  return (
    <section ref={sectionRef} className="section-padding bg-slate-900 relative overflow-hidden">
      {/* Animated background */}
      <motion.div
        style={prefersReducedMotion ? {} : { y: backgroundY }}
        className="absolute inset-0"
      >
        <GradientOrb
          color="rgba(59, 130, 246, 0.15)"
          size={500}
          blur={120}
          className="absolute -top-40 -left-20"
          duration={15}
        />
        <GradientOrb
          color="rgba(249, 115, 22, 0.1)"
          size={400}
          blur={100}
          className="absolute bottom-0 right-0"
          duration={12}
          delay={3}
        />
        <GradientOrb
          color="rgba(34, 197, 94, 0.1)"
          size={300}
          blur={80}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
          duration={18}
          delay={6}
        />
      </motion.div>

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '50px 50px',
        }}
      />

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
            transition={{ delay: 0.1 }}
            className="inline-block text-sm font-semibold text-orange-400 mb-4 uppercase tracking-wider px-4 py-1.5 bg-orange-500/10 rounded-full border border-orange-500/20"
          >
            {t('badge')}
          </motion.span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-400">{t('subtitle')}</p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => {
            const colors = colorMap[value.color];
            const Icon = value.icon;

            return (
              <motion.div
                key={value.key}
                initial={{ opacity: 0, y: 30, scale: 0.95 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
              >
                <Tilt3D maxRotation={6} perspective={1000} scale={1.02}>
                  <div
                    className={`
                      relative bg-gradient-to-br ${colors.gradient}
                      rounded-3xl p-8 border border-slate-700/50
                      backdrop-blur-sm
                    `}
                  >
                    {/* Glow effect */}
                    <div
                      className={`absolute -inset-px rounded-3xl bg-gradient-to-br ${colors.gradient} opacity-50 blur-xl`}
                    />

                    <div className="relative">
                      {/* Icon */}
                      <motion.div
                        initial={prefersReducedMotion ? {} : { scale: 0, rotate: -180 }}
                        whileInView={{ scale: 1, rotate: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2 + index * 0.1, type: 'spring', stiffness: 200 }}
                        className={`w-16 h-16 ${colors.bg} rounded-2xl flex items-center justify-center mb-6 shadow-lg ${colors.glow}`}
                      >
                        <Icon className="w-8 h-8 text-white" />
                      </motion.div>

                      <h3 className="text-xl font-bold text-white mb-4">{value.title}</h3>

                      {/* Animated metric */}
                      <div className="mb-4">
                        <span className="text-6xl font-bold text-white">
                          <AnimatedCounter
                            value={value.metric}
                            prefix={value.prefix}
                            suffix={value.suffix}
                            duration={2}
                            delay={0.5 + index * 0.2}
                          />
                        </span>
                        <span className="text-slate-400 ml-2 text-lg">{value.metricLabel}</span>
                      </div>

                      <p className="text-slate-400">{value.description}</p>

                      {/* Decorative line */}
                      <motion.div
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.6 + index * 0.1, duration: 0.8 }}
                        className={`h-1 ${colors.bg} rounded-full mt-6 origin-left`}
                      />
                    </div>
                  </div>
                </Tilt3D>
              </motion.div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
