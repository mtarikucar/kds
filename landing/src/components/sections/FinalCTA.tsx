'use client';

import { Container } from '@/components/ui/Container';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getStats } from '@/lib/api';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export default function FinalCTA() {
  const stats = getStats();
  const t = useTranslations('cta');
  const sectionRef = useScrollReveal<HTMLElement>();

  const titleWords = t('title').split(' ');

  return (
    <section
      ref={sectionRef}
      className="section-padding relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"
    >
      {/* Background gradient orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="gradient-orb animate-float-slow"
          style={{
            top: 0,
            left: '25%',
            width: '600px',
            height: '600px',
            background: 'radial-gradient(circle, rgba(249, 115, 22, 0.15) 0%, transparent 70%)',
            filter: 'blur(150px)',
          }}
        />
        <div
          className="gradient-orb animate-float"
          style={{
            bottom: 0,
            right: '25%',
            width: '500px',
            height: '500px',
            background: 'radial-gradient(circle, rgba(107, 33, 168, 0.1) 0%, transparent 70%)',
            filter: 'blur(120px)',
            animationDelay: '3s',
          }}
        />
        <div
          className="gradient-orb animate-float-slow"
          style={{
            top: '50%',
            right: 0,
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(249, 115, 22, 0.08) 0%, transparent 70%)',
            filter: 'blur(100px)',
            animationDelay: '6s',
          }}
        />
      </div>

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
          <div className="text-center" data-animate="fade">
            {/* Word-by-word reveal heading */}
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-6 perspective-1000">
              {titleWords.map((word, i) => (
                <span
                  key={i}
                  className="animate-word-reveal inline-block mr-[0.3em]"
                  style={{ '--word-delay': `${0.3 + i * 0.05}s` } as React.CSSProperties}
                >
                  {word}
                </span>
              ))}
            </h2>

            <p
              data-animate="fade"
              style={{ '--delay': '0.3s' } as React.CSSProperties}
              className="text-xl text-slate-400 mb-10"
            >
              {t('subtitle', { count: stats.restaurantCount })}
            </p>

            <div
              data-animate="slide-up"
              style={{ '--delay': '0.4s' } as React.CSSProperties}
              className="flex flex-col sm:flex-row gap-4 justify-center mb-12"
            >
              <a
                href="/app/register"
                className="hover-lift inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-slate-900 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl hover:from-amber-500 hover:to-orange-500 transition-all shadow-lg shadow-orange-500/20 group"
              >
                {t('primaryBtn')}
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </a>
              <a
                href="#contact"
                className="hover-lift inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-white border border-white/20 rounded-2xl hover:bg-white/10 hover:border-white/30 transition-all backdrop-blur-sm"
              >
                <MessageCircle className="w-5 h-5" />
                {t('secondaryBtn')}
              </a>
            </div>

            {/* Trust indicators */}
            <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-slate-400">
              {['trustBadge1', 'trustBadge2', 'trustBadge3'].map((badge, index) => (
                <div
                  key={badge}
                  data-animate="slide-left"
                  style={{ '--delay': `${0.5 + index * 0.1}s` } as React.CSSProperties}
                  className="flex items-center gap-2"
                >
                  <svg
                    className="w-5 h-5 text-orange-500"
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
        </div>
      </Container>
    </section>
  );
}
