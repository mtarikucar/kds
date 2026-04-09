'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Container } from '@/components/ui/Container';
import { QrCode, LayoutGrid, CreditCard, ChefHat, Building2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { QRMenuMockup } from '@/components/mockups/QRMenuMockup';
import { OrdersMockup } from '@/components/mockups/OrdersMockup';
import { POSMockup } from '@/components/mockups/POSMockup';
import { KitchenMockup } from '@/components/mockups/KitchenMockup';
import { DashboardMockup } from '@/components/mockups/DashboardMockup';
import { AnimatedCounter } from '@/components/animations/AnimatedCounter';

export default function FeatureScroller() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(-1);
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rafRef = useRef<number>(0);
  const t = useTranslations('features');

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    setMounted(true);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const features = [
    {
      id: 'qr-menu',
      icon: QrCode,
      title: t('qrMenu.title'),
      description: t('qrMenu.description'),
      bullets: t.raw('qrMenu.bullets') as string[],
      metrics: [
        { label: t('qrMenu.metrics.printingCosts'), value: 0, prefix: '₺', suffix: '' },
        { label: t('qrMenu.metrics.updateTime'), value: t('qrMenu.metrics.instant'), isText: true },
      ],
      mockup: 'qr-menu',
      color: 'orange',
    },
    {
      id: 'order-management',
      icon: LayoutGrid,
      title: t('orderManagement.title'),
      description: t('orderManagement.description'),
      bullets: t.raw('orderManagement.bullets') as string[],
      metrics: [
        { label: t('orderManagement.metrics.orderProcessing'), value: t('orderManagement.metrics.faster'), isText: true },
        { label: t('orderManagement.metrics.tableTurnover'), value: 25, prefix: '+', suffix: '%' },
      ],
      mockup: 'orders',
      color: 'blue',
    },
    {
      id: 'pos-payments',
      icon: CreditCard,
      title: t('posPayments.title'),
      description: t('posPayments.description'),
      bullets: t.raw('posPayments.bullets') as string[],
      metrics: [
        { label: t('posPayments.metrics.paymentSuccess'), value: 99.9, suffix: '%' },
        { label: t('posPayments.metrics.checkoutTime'), value: 30, prefix: '<', suffix: 's' },
      ],
      mockup: 'pos',
      color: 'green',
    },
    {
      id: 'kitchen-flow',
      icon: ChefHat,
      title: t('kitchenFlow.title'),
      description: t('kitchenFlow.description'),
      bullets: t.raw('kitchenFlow.bullets') as string[],
      metrics: [
        { label: t('kitchenFlow.metrics.orderErrors'), value: 85, prefix: '-', suffix: '%' },
        { label: t('kitchenFlow.metrics.avgPrepTime'), value: 12, suffix: ' min' },
      ],
      mockup: 'kitchen',
      color: 'red',
    },
    {
      id: 'multi-branch',
      icon: Building2,
      title: t('multiBranch.title'),
      description: t('multiBranch.description'),
      bullets: t.raw('multiBranch.bullets') as string[],
      metrics: [
        { label: t('multiBranch.metrics.branches'), value: t('multiBranch.metrics.unlimited'), isText: true },
        { label: t('multiBranch.metrics.syncTime'), value: t('multiBranch.metrics.realTime'), isText: true },
      ],
      mockup: 'dashboard',
      color: 'purple',
    },
  ];

  // Scroll-driven feature switching
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrolled = -rect.top;
    const scrollHeight = container.offsetHeight - window.innerHeight;
    const progress = Math.max(0, Math.min(1, scrolled / scrollHeight));

    const newIndex = Math.min(4, Math.floor(progress * 5));

    setActiveIndex((prev) => {
      if (prev !== newIndex) {
        setPrevIndex(prev);
      }
      return newIndex;
    });
  }, []);

  useEffect(() => {
    if (isMobile) return;

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(handleScroll);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [handleScroll, isMobile]);

  // Clear prevIndex after transition completes
  useEffect(() => {
    if (prevIndex >= 0) {
      const timer = setTimeout(() => setPrevIndex(-1), 500);
      return () => clearTimeout(timer);
    }
  }, [prevIndex]);

  const activeFeature = features[activeIndex];
  const Icon = activeFeature.icon;

  const renderMockup = (mockupId: string) => {
    switch (mockupId) {
      case 'qr-menu':
        return <QRMenuMockup className="scale-90 origin-center" />;
      case 'orders':
        return <OrdersMockup className="w-full max-w-md" />;
      case 'pos':
        return <POSMockup className="w-full max-w-lg h-[380px]" />;
      case 'kitchen':
        return <KitchenMockup className="w-full max-w-lg" />;
      case 'dashboard':
        return <DashboardMockup className="w-full max-w-lg" interactive={false} />;
      default:
        return null;
    }
  };

  const colorVariants: Record<string, { bg: string; text: string; gradient: string }> = {
    orange: { bg: 'bg-orange-500', text: 'text-orange-600', gradient: 'from-orange-500/20 to-amber-500/10' },
    blue: { bg: 'bg-blue-500', text: 'text-blue-600', gradient: 'from-blue-500/20 to-cyan-500/10' },
    green: { bg: 'bg-green-500', text: 'text-green-600', gradient: 'from-green-500/20 to-emerald-500/10' },
    red: { bg: 'bg-red-500', text: 'text-red-600', gradient: 'from-red-500/20 to-rose-500/10' },
    purple: { bg: 'bg-purple-500', text: 'text-purple-600', gradient: 'from-purple-500/20 to-violet-500/10' },
  };

  const colors = colorVariants[activeFeature.color];

  // Reduced motion or mobile fallback - simple list view
  const prefersReduced = mounted && typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReduced || (mounted && isMobile)) {
    return (
      <section id="features" className="section-padding bg-slate-50">
        <Container>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <span className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider">
              {t('badge')}
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
              {t('title')}
            </h2>
            <p className="text-lg text-slate-600">{t('subtitle')}</p>
          </div>

          <div className="space-y-16">
            {features.map((feature) => {
              const FeatureIcon = feature.icon;
              return (
                <div key={feature.id} className="bg-white rounded-2xl p-8 shadow-lg">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center">
                      <FeatureIcon className="w-6 h-6 text-white" />
                    </div>
                    <h3 className="text-2xl font-bold text-slate-900">{feature.title}</h3>
                  </div>
                  <p className="text-slate-600 mb-6">{feature.description}</p>
                  <ul className="space-y-2">
                    {feature.bullets.map((bullet, i) => (
                      <li key={i} className="flex items-start gap-2 text-slate-700">
                        <span className="text-green-500">&#10003;</span>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section id="features" className="relative bg-slate-50">
      {/* Scroll container */}
      <div ref={containerRef} className="relative" style={{ height: '300vh' }}>
        {/* Sticky container */}
        <div className="sticky top-0 h-screen overflow-hidden">
          {/* Background gradient */}
          <div className={`absolute inset-0 bg-gradient-to-br ${colors.gradient} transition-colors duration-700`} />

          {/* Gradient orbs */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div
              className="gradient-orb"
              style={{
                top: '-160px',
                right: '-160px',
                width: '500px',
                height: '500px',
                background: 'radial-gradient(circle, rgba(249, 115, 22, 0.15) 0%, transparent 70%)',
                filter: 'blur(100px)',
              }}
            />
            <div
              className="gradient-orb"
              style={{
                bottom: '80px',
                left: '-80px',
                width: '400px',
                height: '400px',
                background: 'radial-gradient(circle, rgba(59, 130, 246, 0.1) 0%, transparent 70%)',
                filter: 'blur(80px)',
              }}
            />
          </div>

          <Container className="relative h-full py-8">
            {/* Section header */}
            <div className="text-center pt-8 mb-8">
              <span className="inline-block text-sm font-semibold text-orange-600 mb-2 uppercase tracking-wider">
                {t('badge')}
              </span>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight">
                {t('title')}
              </h2>
            </div>

            {/* Main content grid */}
            <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center h-[calc(100%-140px)]">
              {/* Left: Feature content */}
              <div className="relative">
                {/* Progress indicator */}
                <div className="absolute -left-4 top-0 bottom-0 hidden lg:flex flex-col justify-center gap-3">
                  {features.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        if (containerRef.current) {
                          const scrollHeight = containerRef.current.offsetHeight;
                          const targetScroll = (index / 5) * scrollHeight;
                          window.scrollTo({
                            top: containerRef.current.offsetTop + targetScroll,
                            behavior: 'smooth',
                          });
                        }
                      }}
                      className="relative w-3 h-3"
                    >
                      <div
                        className={`absolute inset-0 rounded-full transition-all duration-300 ${
                          activeIndex === index ? `${colors.bg} scale-150` : 'bg-slate-300 scale-100'
                        }`}
                      />
                      {activeIndex === index && (
                        <div
                          className={`absolute inset-0 rounded-full ${colors.bg} opacity-30 animate-pulse-ring`}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Feature content with CSS transitions */}
                <div className="relative">
                  <div
                    key={activeFeature.id}
                    className="bg-white/90 rounded-3xl p-6 lg:p-8 shadow-2xl shadow-slate-900/5 border border-white/50 feature-content-enter"
                  >
                    {/* Feature header */}
                    <div className="flex items-start gap-4 mb-6">
                      <div
                        className={`w-14 h-14 ${colors.bg} rounded-2xl flex items-center justify-center shadow-lg animate-icon-spring`}
                        key={`icon-${activeFeature.id}`}
                      >
                        <Icon className="w-7 h-7 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl lg:text-2xl font-bold text-slate-900 mb-1">
                          {activeFeature.title}
                        </h3>
                        <p className="text-slate-600">
                          {activeFeature.description}
                        </p>
                      </div>
                    </div>

                    {/* Feature bullets */}
                    <ul className="space-y-3 mb-6">
                      {activeFeature.bullets.map((bullet, i) => (
                        <li
                          key={`${activeFeature.id}-${i}`}
                          className="flex items-start gap-3 animate-hero-fade-in"
                          style={{ animationDelay: `${0.1 + i * 0.08}s` }}
                        >
                          <svg
                            className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5 animate-check-pop"
                            style={{ animationDelay: `${0.15 + i * 0.08}s` }}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                          <span className="text-slate-700">{bullet}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Feature metrics */}
                    <div className="flex flex-wrap gap-4">
                      {activeFeature.metrics.map((metric, i) => (
                        <div
                          key={metric.label}
                          className="bg-slate-50 rounded-xl px-5 py-4 flex-1 min-w-[140px]"
                        >
                          <div className="text-2xl lg:text-3xl font-bold text-slate-900">
                            {'isText' in metric && metric.isText ? (
                              metric.value
                            ) : (
                              <AnimatedCounter
                                value={metric.value as number}
                                prefix={'prefix' in metric ? metric.prefix : undefined}
                                suffix={'suffix' in metric ? metric.suffix : undefined}
                                duration={1.5}
                                delay={0.3 + i * 0.2}
                              />
                            )}
                          </div>
                          <div className="text-sm text-slate-500">{metric.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Mobile progress dots */}
                <div className="flex justify-center gap-2 mt-6 lg:hidden">
                  {features.map((_, index) => (
                    <div
                      key={index}
                      className={`w-2 h-2 rounded-full transition-all duration-300 ${
                        activeIndex === index ? `${colors.bg} scale-[1.3]` : 'bg-slate-300'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Right: Animated mockup */}
              <div className="relative hidden lg:flex items-center justify-center perspective-1000">
                <div
                  key={activeFeature.mockup}
                  className="relative feature-mockup-enter"
                >
                  {renderMockup(activeFeature.mockup)}

                  {/* Decorative glow */}
                  <div
                    className={`absolute -z-10 w-full h-full ${colors.bg} opacity-10 blur-3xl rounded-full animate-glow-pulse`}
                  />
                </div>
              </div>
            </div>

            {/* Scroll hint */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-slate-400 text-xs animate-glow-pulse">
              {activeIndex < features.length - 1 ? (
                <span>{t('scrollHint')} &bull; {activeIndex + 1}/{features.length}</span>
              ) : (
                <span>{t('continueScrolling')}</span>
              )}
            </div>
          </Container>
        </div>
      </div>
    </section>
  );
}
