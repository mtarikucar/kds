'use client';

import { ArrowRight, Play, ChevronDown } from 'lucide-react';
import { Container } from '@/components/ui/Container';
import { useTranslations } from 'next-intl';
import { DashboardMockup } from '@/components/mockups/DashboardMockup';
import { useScrollFade } from '@/hooks/useScrollFade';

export default function Hero() {
  const t = useTranslations('hero');

  const { ref: sectionRef, style: fadeStyle } = useScrollFade<HTMLElement>({
    fadeEnd: 0.5,
    scale: true,
    translateY: true,
  });

  const headlineWords = t('headline').split(' ');

  return (
    <section
      ref={sectionRef}
      className="relative min-h-screen pt-40 pb-20 lg:pt-48 lg:pb-32 overflow-hidden"
    >
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />

      {/* Floating gradient orbs - pure CSS */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="gradient-orb animate-float-slow"
          style={{
            top: '-80px',
            left: '-160px',
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, rgba(212, 160, 23, 0.3) 0%, transparent 70%)',
            filter: 'blur(120px)',
          }}
        />
        <div
          className="gradient-orb animate-float"
          style={{
            top: '160px',
            right: '-80px',
            width: '500px',
            height: '500px',
            background: 'radial-gradient(circle, rgba(107, 33, 168, 0.25) 0%, transparent 70%)',
            filter: 'blur(100px)',
            animationDelay: '2s',
          }}
        />
        <div
          className="gradient-orb animate-float-slow"
          style={{
            bottom: '80px',
            left: '25%',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(212, 160, 23, 0.15) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animationDelay: '4s',
          }}
        />

        {/* Decorative floating dots */}
        <div
          className="absolute top-32 right-[15%] w-4 h-4 bg-orange-500/30 rounded-full blur-sm animate-float"
          style={{ animationDuration: '4s' }}
        />
        <div
          className="absolute top-48 left-[20%] w-3 h-3 bg-amber-400/40 rounded-full blur-sm animate-float"
          style={{ animationDuration: '5s', animationDelay: '1s' }}
        />
        <div
          className="absolute bottom-40 right-[25%] w-5 h-5 bg-orange-500/20 rounded-full blur-sm animate-float"
          style={{ animationDuration: '6s', animationDelay: '2s' }}
        />
      </div>

      <div style={fadeStyle}>
        <Container className="relative">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left Content */}
            <div className="text-center lg:text-left">
              {/* Headline with word-by-word reveal */}
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-[1.1] mb-6 perspective-1000">
                {headlineWords.map((word, i) => (
                  <span
                    key={i}
                    className="animate-word-reveal inline-block mr-[0.3em]"
                    style={{ '--word-delay': `${0.2 + i * 0.04}s` } as React.CSSProperties}
                  >
                    {word}
                  </span>
                ))}{' '}
                <span className="bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-400 bg-clip-text text-transparent animate-gradient bg-[length:200%_200%] inline-block animate-hero-fade-in" style={{ animationDelay: '0.6s' }}>
                  {t('headlineHighlight')}
                </span>
              </h1>

              {/* Subtitle */}
              <p
                className="text-lg lg:text-xl text-slate-300 mb-8 max-w-xl mx-auto lg:mx-0 animate-hero-fade-in"
                style={{ animationDelay: '0.4s' }}
              >
                {t('subtitle')}
              </p>

              {/* CTAs */}
              <div
                className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-8 animate-hero-fade-in"
                style={{ animationDelay: '0.5s' }}
              >
                <a
                  href="/app/register"
                  className="hover-lift inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-slate-900 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl hover:from-amber-500 hover:to-orange-500 transition-all hover:shadow-xl hover:shadow-orange-500/20 group"
                >
                  {t('cta')}
                  <ArrowRight
                    size={18}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </a>
                <a
                  href="#product"
                  className="hover-lift inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold text-white/90 bg-white/10 backdrop-blur-sm rounded-2xl border border-white/20 hover:border-white/30 hover:bg-white/15 transition-all"
                >
                  <Play size={18} className="text-orange-500" />
                  {t('ctaSecondary')}
                </a>
              </div>

              {/* Trust badges */}
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-6 text-sm text-slate-400">
                {['trustBadge1', 'trustBadge2', 'trustBadge3'].map((badge, index) => (
                  <div
                    key={badge}
                    className="flex items-center gap-2 animate-badge-slide-in"
                    style={{ animationDelay: `${0.8 + index * 0.1}s` }}
                  >
                    <svg
                      className="w-5 h-5 text-orange-500 animate-check-pop"
                      style={{ animationDelay: `${0.9 + index * 0.1}s` }}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    {t(badge)}
                  </div>
                ))}
              </div>
            </div>

            {/* Right Product Mock with CSS tilt on hover */}
            <div
              className="relative perspective-1000 animate-hero-slide-right"
              style={{ animationDelay: '0.3s' }}
            >
              <div className="hover-tilt-strong transition-transform duration-300">
                <DashboardMockup className="w-full" />
              </div>
            </div>
          </div>
        </Container>
      </div>

      {/* Scroll indicator */}
      <div
        className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-hero-fade-in"
        style={{ animationDelay: '1.5s' }}
      >
        <button
          onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
          className="flex flex-col items-center gap-2 text-slate-400 cursor-pointer animate-scroll-bounce"
        >
          <span className="text-xs font-medium tracking-wider uppercase">Scroll</span>
          <ChevronDown className="w-5 h-5" />
        </button>
      </div>
    </section>
  );
}
