'use client';

import { motion } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Clock, CheckCircle, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function BusinessValue() {
  const t = useTranslations('business');

  const values = [
    {
      key: 'time',
      icon: Clock,
      title: t('values.time.title'),
      metric: t('values.time.metric'),
      metricLabel: t('values.time.metricLabel'),
      description: t('values.time.description'),
      color: 'bg-blue-500',
    },
    {
      key: 'errors',
      icon: CheckCircle,
      title: t('values.errors.title'),
      metric: t('values.errors.metric'),
      metricLabel: t('values.errors.metricLabel'),
      description: t('values.errors.description'),
      color: 'bg-green-500',
    },
    {
      key: 'revenue',
      icon: TrendingUp,
      title: t('values.revenue.title'),
      metric: t('values.revenue.metric'),
      metricLabel: t('values.revenue.metricLabel'),
      description: t('values.revenue.description'),
      color: 'bg-orange-500',
    },
  ];

  return (
    <section className="section-padding bg-slate-900">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <span className="inline-block text-sm font-semibold text-orange-400 mb-4 uppercase tracking-wider">
            {t('badge')}
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-400">
            {t('subtitle')}
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value, index) => (
            <motion.div
              key={value.key}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="relative bg-slate-800/50 rounded-2xl p-8 border border-slate-700/50"
            >
              <div
                className={`w-14 h-14 ${value.color} rounded-xl flex items-center justify-center mb-6`}
              >
                <value.icon className="w-7 h-7 text-white" />
              </div>

              <h3 className="text-xl font-bold text-white mb-2">{value.title}</h3>

              <div className="mb-4">
                <span className="text-5xl font-bold text-white">{value.metric}</span>
                <span className="text-slate-400 ml-2">{value.metricLabel}</span>
              </div>

              <p className="text-slate-400">{value.description}</p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
}
