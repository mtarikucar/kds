'use client';

import { Container } from '@/components/ui/Container';
import { Shield, Lock, Server, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useScrollReveal } from '@/hooks/useScrollReveal';

export default function TrustSecurity() {
  const t = useTranslations('security');
  const sectionRef = useScrollReveal<HTMLElement>();

  const securityPoints = [
    { key: 'encryption', icon: Lock, title: t('points.encryption.title'), description: t('points.encryption.description') },
    { key: 'rbac', icon: Users, title: t('points.rbac.title'), description: t('points.rbac.description') },
    { key: 'uptime', icon: Server, title: t('points.uptime.title'), description: t('points.uptime.description') },
    { key: 'compliance', icon: Shield, title: t('points.compliance.title'), description: t('points.compliance.description') },
  ];

  return (
    <section ref={sectionRef} id="security" className="section-padding bg-gradient-subtle">
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

            <div className="space-y-6">
              {securityPoints.map((point, index) => (
                <div
                  key={point.key}
                  data-animate="slide-left"
                  style={{ '--delay': `${0.1 + index * 0.1}s` } as React.CSSProperties}
                  className="flex gap-4"
                >
                  <div className="flex-shrink-0 w-12 h-12 bg-white rounded-xl shadow-sm border border-slate-200 flex items-center justify-center">
                    <point.icon className="w-6 h-6 text-slate-700" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{point.title}</h3>
                    <p className="text-sm text-slate-600">{point.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Visual */}
          <div data-animate="scale" style={{ '--delay': '0.2s' } as React.CSSProperties} className="relative">
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

                {/* Trust indicators.
                    These were hardcoded English literals — an uptime
                    percentage, a round-the-clock monitoring claim and a
                    blanket encryption claim — sitting outside the message
                    catalogs, which is how they survived the removal that took
                    the same wording out of all five locales: the gate only
                    scanned the catalogs at the time. None of the three was
                    supportable — there is no uptime measurement, no status
                    page and no round-the-clock rota, and AES-256 covers
                    specific credential columns rather than everything.

                    The retired strings are deliberately not repeated here.
                    scripts/claims-check.mjs holds them as fixtures and is the
                    one place they belong; spelling them out again in a comment
                    makes an audit grep report a hit on a file that is clean.

                    Each tile now states something enforced in code, and is
                    translated like the rest of the section. */}
                <div className="grid grid-cols-2 gap-4">
                  {(t.raw('visual.tiles') as { value: string; label: string }[]).map((tile) => (
                    <div key={tile.label} className="bg-slate-50 rounded-xl p-4">
                      <div className="text-3xl font-bold text-slate-900">{tile.value}</div>
                      <div className="text-sm text-slate-500">{tile.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Decorative elements */}
            <div className="absolute -z-10 -bottom-8 -left-8 w-64 h-64 bg-green-100 rounded-full blur-3xl opacity-50" />
          </div>
        </div>
      </Container>
    </section>
  );
}
