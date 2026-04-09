'use client';

import { Container } from '@/components/ui/Container';
import { Zap, Shield, TrendingUp, Globe } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getStats } from '@/lib/api';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export default function ProductOverview() {
  const stats = getStats();
  const t = useTranslations('product');
  const sectionRef = useScrollReveal<HTMLElement>();

  const benefits = [
    { key: 'fast', icon: Zap, title: t('benefits.fast.title'), description: t('benefits.fast.description') },
    { key: 'secure', icon: Shield, title: t('benefits.secure.title'), description: t('benefits.secure.description') },
    { key: 'insights', icon: TrendingUp, title: t('benefits.insights.title'), description: t('benefits.insights.description') },
    { key: 'global', icon: Globe, title: t('benefits.global.title'), description: t('benefits.global.description') },
  ];

  return (
    <section ref={sectionRef} id="product" className="section-padding bg-gradient-subtle">
      <Container>
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left Content */}
          <div data-animate="slide-up">
            <span className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider">
              {t('badge')}
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-6">
              {t('title')}
            </h2>
            <p className="text-lg text-slate-600 mb-8">
              {t('subtitle')}
            </p>

            <div className="grid sm:grid-cols-2 gap-6">
              {benefits.map((benefit, index) => (
                <div
                  key={benefit.key}
                  data-animate="slide-up"
                  style={{ '--delay': `${0.1 + index * 0.1}s` } as React.CSSProperties}
                  className="flex gap-4"
                >
                  <div className="flex-shrink-0 w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                    <benefit.icon className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{benefit.title}</h3>
                    <p className="text-sm text-slate-600">{benefit.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Mock Panels */}
          <div data-animate="slide-right" style={{ '--delay': '0.2s' } as React.CSSProperties} className="relative">
            <div className="space-y-4">
              {/* Panel 1 - Orders Dashboard */}
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-slate-900">Active Orders</h4>
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">Live</span>
                </div>
                <div className="space-y-3">
                  {[
                    { table: 'Table 5', items: '3 items', time: '12 min', status: 'Preparing' },
                    { table: 'Table 2', items: '5 items', time: '8 min', status: 'Ready' },
                    { table: 'Table 9', items: '2 items', time: '3 min', status: 'New' },
                  ].map((order, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                      <div>
                        <div className="font-medium text-slate-900 text-sm">{order.table}</div>
                        <div className="text-xs text-slate-500">{order.items} &bull; {order.time}</div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        order.status === 'Ready' ? 'bg-green-100 text-green-700' :
                        order.status === 'Preparing' ? 'bg-orange-100 text-orange-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {order.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 2 - Analytics */}
              <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-5">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-semibold text-slate-900">Platform Performance</h4>
                  <span className="text-xs text-slate-500">all time</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-slate-900">{stats.totalRevenue}</div>
                    <div className="text-xs text-green-600">Total</div>
                    <div className="text-xs text-slate-500 mt-1">Revenue</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-slate-900">{stats.orderCount}</div>
                    <div className="text-xs text-green-600">Processed</div>
                    <div className="text-xs text-slate-500 mt-1">Orders</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-slate-900">{stats.restaurantCount}</div>
                    <div className="text-xs text-green-600">Active</div>
                    <div className="text-xs text-slate-500 mt-1">Restaurants</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative gradient */}
            <div className="absolute -z-10 -bottom-8 -right-8 w-64 h-64 bg-orange-100 rounded-full blur-3xl opacity-50" />
          </div>
        </div>
      </Container>
    </section>
  );
}
