'use client';

import { appHref } from '@/lib/urls';
import { Container } from '@/components/ui/Container';
import { Check, ArrowRight, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { type CatalogProduct } from '@/lib/api';

interface PricingProps {
  products?: CatalogProduct[];
}

/**
 * Public pricing — the à-la-carte catalog, read from the same endpoint
 * checkout prices from.
 *
 * This section used to render three tiers (Başlangıç ₺499/ay, Profesyonel
 * ₺1.299/ay, Kurumsal ₺2.999/ay) out of static translations, with the API only
 * overlaying a discount badge. When packages were removed in v3.3.0 the API
 * side went empty but the static side kept rendering, so the public homepage
 * went on advertising monthly plans that could no longer be bought at prices
 * that no longer existed.
 *
 * Now the numbers come from the catalog. If the API is unreachable at build
 * time the section renders the free core plus a contact CTA rather than a
 * remembered price — a missing price is recoverable, a wrong one is not.
 */
const KIND_ORDER = ['license', 'module', 'integration', 'capacity', 'credit'] as const;

function formatTry(cents: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default function Pricing({ products }: PricingProps) {
  const t = useTranslations('pricing');
  const sectionRef = useScrollReveal<HTMLElement>();

  const licence = products?.find((p) => p.kind === 'license');
  const paid = (products ?? []).filter((p) => p.kind !== 'license');

  const grouped = KIND_ORDER.filter((k) => k !== 'license')
    .map((kind) => ({ kind, items: paid.filter((p) => p.kind === kind) }))
    .filter((g) => g.items.length > 0);

  const freeFeatures = t.raw('free.features') as string[];

  return (
    <section ref={sectionRef} id="pricing" className="section-padding relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-slate-50 via-white to-slate-50" />

      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="gradient-orb"
          style={{
            top: '-80px',
            right: '25%',
            width: '400px',
            height: '400px',
            background: 'radial-gradient(circle, rgba(249, 115, 22, 0.08) 0%, transparent 70%)',
            filter: 'blur(100px)',
          }}
        />
        <div
          className="gradient-orb"
          style={{
            bottom: '80px',
            left: '25%',
            width: '350px',
            height: '350px',
            background: 'radial-gradient(circle, rgba(107, 33, 168, 0.06) 0%, transparent 70%)',
            filter: 'blur(80px)',
          }}
        />
      </div>

      <Container className="relative">
        <div data-animate="slide-up" className="text-center max-w-3xl mx-auto mb-16">
          <span className="inline-block text-sm font-semibold text-orange-500 mb-4 uppercase tracking-wider">
            {t('badge')}
          </span>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            {t('title')}
          </h2>
          <p className="text-lg text-slate-600">{t('subtitle')}</p>
        </div>

        {/* The free core comes first because it is the offer: the whole
            point-of-sale runs at no cost, with no licence and no limits. */}
        <div
          data-animate="slide-up"
          className="max-w-6xl mx-auto mb-8 rounded-3xl border-2 border-green-500 bg-white p-8 shadow-xl shadow-green-500/10"
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1 text-sm font-semibold text-green-700">
                <Sparkles className="h-4 w-4" />
                {t('free.badge')}
              </div>
              <h3 className="text-2xl font-bold text-slate-900">{t('free.name')}</h3>
              <p className="mt-1 text-slate-600">{t('free.description')}</p>
            </div>
            <a
              href={appHref('/register')}
              className="hover-lift inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-3.5 font-semibold text-white shadow-lg shadow-green-500/25"
            >
              {t('free.cta')}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {freeFeatures.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <Check className="h-5 w-5 flex-shrink-0 text-green-500" />
                <span className="text-slate-600">{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Licence — the prerequisite for anything paid. */}
        {licence && (
          <div
            data-animate="slide-up"
            className="max-w-6xl mx-auto mb-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-xl font-bold text-slate-900">{licence.name}</h3>
                <p className="mt-1 max-w-xl text-sm text-slate-500">
                  {licence.description ?? t('licence.description')}
                </p>
              </div>
              <div className="text-right">
                <span className="text-4xl font-bold text-orange-500">
                  {formatTry(licence.priceCents)}
                </span>
                <span className="text-slate-500">{t('perYear')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Everything else, priced per product. */}
        {grouped.length > 0 ? (
          <div className="max-w-6xl mx-auto space-y-8">
            {grouped.map((group) => (
              <div key={group.kind} data-animate="slide-up">
                <h3 className="mb-4 text-lg font-semibold text-slate-900">
                  {t(`kind.${group.kind}`)}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((product) => (
                    <div
                      key={product.code}
                      className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-200/40"
                    >
                      <h4 className="font-semibold text-slate-900">{product.name}</h4>
                      {product.description && (
                        <p className="mt-1 flex-1 text-sm text-slate-500">
                          {product.description}
                        </p>
                      )}
                      <div className="mt-4">
                        <span className="text-2xl font-bold text-slate-900">
                          {formatTry(product.priceCents)}
                        </span>
                        <span className="text-sm text-slate-500">
                          {product.billing === 'annual'
                            ? t('perYear')
                            : t('oneTime')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mx-auto max-w-xl text-center text-slate-500">
            {t('catalogUnavailable')}
          </p>
        )}

        <p
          data-animate="fade"
          style={{ '--delay': '0.6s' } as React.CSSProperties}
          className="text-center text-sm text-slate-500 mt-12"
        >
          {t('prorationNote')}
        </p>
      </Container>
    </section>
  );
}
