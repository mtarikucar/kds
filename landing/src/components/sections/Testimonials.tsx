'use client';

import { useTranslations } from 'next-intl';
import { Star, Users, Award, Clock, ThumbsUp } from 'lucide-react';

const stats = [
  { key: 'clients', value: '500+', Icon: Users },
  { key: 'rating', value: '4.9/5', Icon: Star },
  { key: 'support', value: '24/7', Icon: Clock },
  { key: 'satisfaction', value: '99%', Icon: ThumbsUp },
];

export default function Testimonials() {
  const t = useTranslations('testimonials');

  return (
    <section className="py-24 bg-gradient-to-b from-orange-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-gray-600">{t('subtitle')}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {stats.map(({ key, value, Icon }) => (
            <div
              key={key}
              className="bg-white rounded-2xl p-6 text-center shadow-sm border border-gray-100"
            >
              <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Icon className="text-orange-500" size={24} />
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-2">
                {value}
              </div>
              <div className="text-sm text-gray-500">{t(`stats.${key}`)}</div>
            </div>
          ))}
        </div>

        {/* Trust Indicator */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium">
            <Award size={16} />
            Trusted by restaurants worldwide
          </div>
        </div>
      </div>
    </section>
  );
}
