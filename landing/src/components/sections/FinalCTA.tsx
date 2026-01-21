'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { ArrowRight, MessageCircle, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { getStats } from '@/lib/api';
import { GradientOrb } from '@/components/animations/FloatingElement';
import { TextReveal } from '@/components/animations/TextReveal';

export default function FinalCTA() {
  const stats = getStats();
  const t = useTranslations('cta');
  const sectionRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  const backgroundY = useTransform(scrollYProgress, [0, 1], [50, -50]);

  return (
    <section
      ref={sectionRef}
      className="section-padding bg-slate-900 relative overflow-hidden"
    >
      {/* Animated background */}
      <motion.div
        style={prefersReducedMotion ? {} : { y: backgroundY }}
        className="absolute inset-0"
      >
        <GradientOrb
          color="rgba(249, 115, 22, 0.15)"
          size={600}
          blur={150}
          className="absolute top-0 left-1/4"
          duration={15}
        />
        <GradientOrb
          color="rgba(59, 130, 246, 0.1)"
          size={500}
          blur={120}
          className="absolute bottom-0 right-1/4"
          duration={18}
          delay={3}
        />
        <GradientOrb
          color="rgba(139, 92, 246, 0.08)"
          size={400}
          blur={100}
          className="absolute top-1/2 right-0"
          duration={12}
          delay={6}
        />
      </motion.div>

      {/* Grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px)`,
          backgroundSize: '30px 30px',
        }}
      />

      <Container className="relative">
        <div className="max-w-3xl mx-auto">
          {/* Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="inline-flex items-center gap-2 px-4 py-2 mb-6 bg-orange-500/10 rounded-full border border-orange-500/20"
            >
              <Sparkles className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-medium text-orange-400">Ready to get started?</span>
            </motion.div>

            {prefersReducedMotion ? (
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6">
                {t('title')}
              </h2>
            ) : (
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6">
                <TextReveal type="word" stagger={0.05} duration={0.5}>
                  {t('title')}
                </TextReveal>
              </h2>
            )}

            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="text-xl text-slate-400 mb-10"
            >
              {t('subtitle', { count: stats.restaurantCount })}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-12"
            >
              <motion.a
                href="/app/register"
                whileHover={prefersReducedMotion ? {} : { scale: 1.03, y: -2 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-slate-900 bg-white rounded-2xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 group"
              >
                {t('primaryBtn')}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </motion.a>
              <motion.a
                href="#contact"
                whileHover={prefersReducedMotion ? {} : { scale: 1.03 }}
                whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                className="inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-white border border-slate-700 rounded-2xl hover:bg-slate-800/50 hover:border-slate-600 transition-all backdrop-blur-sm"
              >
                <MessageCircle className="w-5 h-5" />
                {t('secondaryBtn')}
              </motion.a>
            </motion.div>

            {/* Trust indicators */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 }}
              className="flex flex-wrap items-center justify-center gap-8 text-sm text-slate-400"
            >
              {['trustBadge1', 'trustBadge2', 'trustBadge3'].map((badge, index) => (
                <motion.div
                  key={badge}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                  className="flex items-center gap-2"
                >
                  <motion.svg
                    initial={prefersReducedMotion ? {} : { scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.7 + index * 0.1, type: 'spring' }}
                    className="w-5 h-5 text-green-400"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </motion.svg>
                  {t(badge)}
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
