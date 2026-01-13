'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle, Sparkles } from 'lucide-react';

export default function Hero() {
  const t = useTranslations('hero');

  const trustBadges = [
    t('trustBadge1'),
    t('trustBadge2'),
    t('trustBadge3'),
  ];

  return (
    <section className="relative pt-32 pb-20 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-orange-50/50 via-white to-white" />

      {/* Decorative elements */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-orange-200 rounded-full blur-3xl opacity-20" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-yellow-200 rounded-full blur-3xl opacity-20" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-orange-100 text-orange-700 px-4 py-2 rounded-full text-sm font-medium mb-8 animate-fade-in">
            <Sparkles size={16} />
            {t('badge')}
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 animate-fade-in animate-delay-100">
            {t('headline')}{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-amber-500">
              {t('headlineHighlight')}
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg sm:text-xl text-gray-600 mb-10 max-w-2xl mx-auto animate-fade-in animate-delay-200">
            {t('subtitle')}
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12 animate-fade-in animate-delay-300">
            <a
              href="/app/register"
              className="group bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:shadow-lg hover:shadow-orange-500/25 flex items-center gap-2"
            >
              {t('cta')}
              <ArrowRight
                size={20}
                className="group-hover:translate-x-1 transition-transform"
              />
            </a>
            <a
              href="#features"
              className="text-gray-700 hover:text-orange-500 px-8 py-4 rounded-xl font-semibold text-lg transition-colors border border-gray-200 hover:border-orange-200"
            >
              {t('ctaSecondary')}
            </a>
          </div>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500">
            {trustBadges.map((badge, index) => (
              <div key={index} className="flex items-center gap-2">
                <CheckCircle size={16} className="text-green-500" />
                {badge}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
