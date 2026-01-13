'use client';

import { useTranslations } from 'next-intl';
import {
  QrCode,
  LayoutDashboard,
  Users,
  CreditCard,
  BarChart3,
  Globe,
} from 'lucide-react';

const featureIcons = [
  { key: 'pos', Icon: QrCode, color: 'bg-blue-500' },
  { key: 'kitchen', Icon: LayoutDashboard, color: 'bg-orange-500' },
  { key: 'tables', Icon: Users, color: 'bg-green-500' },
  { key: 'payments', Icon: CreditCard, color: 'bg-purple-500' },
  { key: 'analytics', Icon: BarChart3, color: 'bg-pink-500' },
  { key: 'multilang', Icon: Globe, color: 'bg-indigo-500' },
];

export default function Features() {
  const t = useTranslations('features');

  return (
    <section id="features" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-gray-600">{t('subtitle')}</p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {featureIcons.map(({ key, Icon, color }) => (
            <div
              key={key}
              className="bg-white rounded-2xl p-8 shadow-sm hover:shadow-lg transition-shadow border border-gray-100 group"
            >
              <div
                className={`${color} w-14 h-14 rounded-xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}
              >
                <Icon className="text-white" size={28} />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                {t(`${key}.title`)}
              </h3>
              <p className="text-gray-600">{t(`${key}.description`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
