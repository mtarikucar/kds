'use client';

import { Container } from '@/components/ui/Container';
import { Clock, CheckCircle, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AnimatedCounter } from '@/components/animations/AnimatedCounter';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export default function BusinessValue() {
  const t = useTranslations('business');
  const sectionRef = useScrollReveal<HTMLElement>();

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
    blue: { bg: 'bg-blue-500', glow: 'shadow-blue-500/30', gradient: 'from-blue-500/20 to-blue-600/10' },
    green: { bg: 'bg-green-500', glow: 'shadow-green-500/30', gradient: 'from-green-500/20 to-green-600/10' },
    orange: { bg: 'bg-orange-500', glow: 'shadow-orange-500/30', gradient: 'from-orange-500/20 to-orange-600/10' },
  };

  return (
    <section ref={sectionRef} className="section-padding bg-slate-900 relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="gradient-orb animate-float-slow"
          style={{
            top: '-160px',
            left: '-80px',
            width: '500px',
            height: '500px',
            background: 'radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%)',
            filter: 'blur(120px)',
          }}
        />
        <div
          className="gradient-orb animate-float"
          style={{
            bottom: 0,
            right: 0,
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(249, 115, 22, 0.1) 0%, transparent 70%)',
            filter: 'blur(100px)',
            animationDelay: '3s',
          }}
        />
        <div
          className="gradient-orb animate-float-slow"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '300px',
            height: '300px',
            background: 'radial-gradient(circle, rgba(34, 197, 94, 0.1) 0%, transparent 70%)',
            filter: 'blur(80px)',
            animationDelay: '6s',
          }}
        />
      </div>

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
        <div data-animate="slide-up" className="text-center max-w-3xl mx-auto mb-16">
          <span className="inline-block text-sm font-semibold text-orange-400 mb-4 uppercase tracking-wider px-4 py-1.5 bg-orange-500/10 rounded-full border border-orange-500/20">
            {t('badge')}
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-400">{t('subtitle')}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => {
            const valColors = colorMap[value.color];
            const ValueIcon = value.icon;

            return (
              <div
                key={value.key}
                data-animate="scale-up"
                style={{ '--delay': `${index * 0.15}s` } as React.CSSProperties}
              >
                <div className="hover-tilt">
                  <div
                    className={`relative bg-gradient-to-br ${valColors.gradient} rounded-3xl p-8 border border-slate-700/50 backdrop-blur-sm`}
                  >
                    {/* Glow effect */}
                    <div
                      className={`absolute -inset-px rounded-3xl bg-gradient-to-br ${valColors.gradient} opacity-50 blur-xl`}
                    />

                    <div className="relative">
                      {/* Icon */}
                      <div
                        className={`w-16 h-16 ${valColors.bg} rounded-2xl flex items-center justify-center mb-6 shadow-lg ${valColors.glow} animate-icon-spring`}
                        style={{ '--delay': `${0.2 + index * 0.1}s` } as React.CSSProperties}
                      >
                        <ValueIcon className="w-8 h-8 text-white" />
                      </div>

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
                      <div
                        className={`h-1 ${valColors.bg} rounded-full mt-6 animate-line-grow`}
                        style={{ '--delay': `${0.6 + index * 0.1}s` } as React.CSSProperties}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
