'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, Variants } from 'framer-motion';
import { ArrowRight, Play, ChevronDown } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useTranslations } from 'next-intl';
import { getStats } from '@/lib/api';
import { TextReveal, GradientText } from '@/components/animations/TextReveal';
import { FloatingElement, GradientOrb } from '@/components/animations/FloatingElement';
import { Tilt3D } from '@/components/animations/Tilt3D';
import { ParallaxLayer } from '@/components/animations/ParallaxLayer';
import { DashboardMockup } from '@/components/mockups/DashboardMockup';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6 },
  },
};

const noAnimationVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

export default function Hero() {
  const prefersReducedMotion = useReducedMotion();
  const stats = getStats();
  const t = useTranslations('hero');
  const sectionRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.5], [0, 100]);
  const heroScale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);

  const variants = prefersReducedMotion ? noAnimationVariants : containerVariants;
  const childVariants = prefersReducedMotion ? noAnimationVariants : itemVariants;

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen pt-32 pb-20 lg:pt-40 lg:pb-32 overflow-hidden"
    >
      {/* Animated background gradient */}
      <div className="absolute inset-0 bg-gradient-hero" />

      {/* Floating gradient orbs with parallax */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <ParallaxLayer speed={0.3}>
          <GradientOrb
            color="rgba(249, 115, 22, 0.4)"
            size={600}
            blur={120}
            className="absolute -top-20 -left-40"
            duration={10}
          />
        </ParallaxLayer>

        <ParallaxLayer speed={0.5}>
          <GradientOrb
            color="rgba(251, 191, 36, 0.3)"
            size={500}
            blur={100}
            className="absolute top-40 -right-20"
            duration={12}
            delay={2}
          />
        </ParallaxLayer>

        <ParallaxLayer speed={0.2}>
          <GradientOrb
            color="rgba(249, 115, 22, 0.2)"
            size={400}
            blur={80}
            className="absolute bottom-20 left-1/4"
            duration={8}
            delay={4}
          />
        </ParallaxLayer>

        {/* Decorative floating elements */}
        <FloatingElement
          className="absolute top-32 right-[15%] w-4 h-4 bg-orange-400/30 rounded-full blur-sm"
          duration={4}
          amplitude={15}
        />
        <FloatingElement
          className="absolute top-48 left-[20%] w-3 h-3 bg-amber-400/40 rounded-full blur-sm"
          duration={5}
          delay={1}
          amplitude={20}
        />
        <FloatingElement
          className="absolute bottom-40 right-[25%] w-5 h-5 bg-orange-300/30 rounded-full blur-sm"
          duration={6}
          delay={2}
          amplitude={18}
        />
      </div>

      <motion.div
        style={prefersReducedMotion ? {} : { opacity: heroOpacity, y: heroY, scale: heroScale }}
      >
        <Container className="relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left Content */}
            <motion.div
              variants={variants}
              initial="hidden"
              animate="visible"
              className="text-center lg:text-left"
            >
              {/* Badge */}
              <motion.div
                variants={childVariants}
                className="inline-flex items-center gap-2 px-4 py-2 mb-6 text-sm font-medium text-slate-600 bg-white/90 rounded-full border border-slate-200/50 backdrop-blur-md shadow-lg shadow-slate-200/20"
              >
                <motion.span
                  className="w-2 h-2 bg-green-500 rounded-full"
                  animate={prefersReducedMotion ? {} : { scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                {t('badge', { count: stats.restaurantCount })}
              </motion.div>

              {/* Headline with text reveal */}
              <motion.div variants={childVariants}>
                {prefersReducedMotion ? (
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-[1.1] mb-6">
                    {t('headline')}{' '}
                    <span className="text-gradient">{t('headlineHighlight')}</span>
                  </h1>
                ) : (
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-900 tracking-tight leading-[1.1] mb-6">
                    <TextReveal type="word" stagger={0.04} duration={0.5}>
                      {t('headline')}
                    </TextReveal>{' '}
                    <GradientText colors={['#f97316', '#ea580c', '#fb923c']}>
                      {t('headlineHighlight')}
                    </GradientText>
                  </h1>
                )}
              </motion.div>

              {/* Subtitle */}
              <motion.p
                variants={childVariants}
                className="text-lg lg:text-xl text-slate-600 mb-8 max-w-xl mx-auto lg:mx-0"
              >
                {t('subtitle')}
              </motion.p>

              {/* CTAs */}
              <motion.div
                variants={childVariants}
                className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8"
              >
                <motion.a
                  href="/app/register"
                  whileHover={prefersReducedMotion ? {} : { scale: 1.02, y: -2 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white bg-slate-900 rounded-2xl hover:bg-slate-800 transition-all hover:shadow-xl hover:shadow-slate-900/20 group"
                >
                  {t('cta')}
                  <ArrowRight
                    size={18}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </motion.a>
                <motion.a
                  href="#product"
                  whileHover={prefersReducedMotion ? {} : { scale: 1.02 }}
                  whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
                  className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-slate-700 bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200 hover:border-slate-300 hover:bg-white hover:shadow-lg transition-all"
                >
                  <Play size={18} className="text-orange-500" />
                  {t('ctaSecondary')}
                </motion.a>
              </motion.div>

              {/* Trust badges */}
              <motion.div
                variants={childVariants}
                className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm text-slate-500"
              >
                {['trustBadge1', 'trustBadge2', 'trustBadge3'].map((badge, index) => (
                  <motion.div
                    key={badge}
                    initial={prefersReducedMotion ? {} : { opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.8 + index * 0.1 }}
                    className="flex items-center gap-2"
                  >
                    <motion.svg
                      className="w-5 h-5 text-green-500"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                      initial={prefersReducedMotion ? {} : { scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.9 + index * 0.1, type: 'spring' }}
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

            {/* Right Product Mock with 3D tilt */}
            <motion.div
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, x: 60, rotateY: -10 }}
              animate={{ opacity: 1, x: 0, rotateY: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
              className="relative perspective-1000"
            >
              <Tilt3D maxRotation={8} perspective={1200} scale={1.02} glare>
                <DashboardMockup className="w-full" />
              </Tilt3D>
            </motion.div>
          </div>
        </Container>
      </motion.div>

      {/* Scroll indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5 }}
        style={prefersReducedMotion ? {} : { opacity: useTransform(scrollYProgress, [0, 0.1], [1, 0]) }}
      >
        <motion.div
          animate={prefersReducedMotion ? {} : { y: [0, 8, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          className="flex flex-col items-center gap-2 text-slate-400 cursor-pointer"
          onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
        >
          <span className="text-xs font-medium tracking-wider uppercase">Scroll</span>
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </motion.div>
    </section>
  );
}
