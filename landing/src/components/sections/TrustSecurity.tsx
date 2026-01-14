'use client';

import { motion } from 'framer-motion';
import { Container } from '@/components/ui/Container';
import { Shield, Lock, Server, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function TrustSecurity() {
  const t = useTranslations('security');

  const securityPoints = [
    {
      key: 'encryption',
      icon: Lock,
      title: t('points.encryption.title'),
      description: t('points.encryption.description'),
    },
    {
      key: 'rbac',
      icon: Users,
      title: t('points.rbac.title'),
      description: t('points.rbac.description'),
    },
    {
      key: 'uptime',
      icon: Server,
      title: t('points.uptime.title'),
      description: t('points.uptime.description'),
    },
    {
      key: 'compliance',
      icon: Shield,
      title: t('points.compliance.title'),
      description: t('points.compliance.description'),
    },
  ];

  return (
    <section id="security" className="section-padding bg-gradient-subtle">
      <Container>
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          {/* Left Content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <span className="inline-block text-sm font-semibold text-orange-600 mb-4 uppercase tracking-wider">
              {t('badge')}
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-6">
              {t('title')}
            </h2>
            <p className="text-lg text-slate-600 mb-8">
              {t('subtitle')}
            </p>

            <div className="space-y-6">
              {securityPoints.map((point, index) => (
                <motion.div
                  key={point.key}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  className="flex gap-4"
                >
                  <div className="flex-shrink-0 w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center">
                    <point.icon className="w-6 h-6 text-slate-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{point.title}</h3>
                    <p className="text-sm text-slate-600">{point.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right Visual */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative"
          >
            <div className="relative bg-white rounded-2xl shadow-2xl shadow-slate-200/50 border border-slate-200/50 p-8 lg:p-12">
              {/* Security visual mockup */}
              <div className="text-center">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Shield className="w-10 h-10 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{t('visual.title')}</h3>
                <p className="text-slate-600 mb-8">
                  {t('visual.subtitle')}
                </p>

                {/* Trust indicators */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">256-bit</div>
                    <div className="text-sm text-slate-500">Encryption</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">99.9%</div>
                    <div className="text-sm text-slate-500">Uptime</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">24/7</div>
                    <div className="text-sm text-slate-500">Monitoring</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="text-3xl font-bold text-slate-900">GDPR</div>
                    <div className="text-sm text-slate-500">Compliant</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -z-10 -bottom-8 -left-8 w-64 h-64 bg-green-100 rounded-full blur-3xl opacity-50" />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
