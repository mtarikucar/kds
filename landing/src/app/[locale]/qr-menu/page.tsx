import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { QRMenuMockup } from '@/components/mockups/QRMenuMockup';
import { appHref } from '@/lib/urls';
import { locales, localeConfig } from '@/i18n/config';
import {
  Zap,
  ClipboardList,
  Languages,
  Wheat,
  Palette,
  LayoutGrid,
  Check,
  Phone,
  MapPin,
} from 'lucide-react';

/**
 * SEO landing page for the free QR menu ("karekod menü" in Turkish — both
 * terms are targeted on purpose). Fully static: all copy comes from the
 * message catalog, so the page renders per-locale at build time and stays
 * cheap to crawl. FAQ + SoftwareApplication structured data below feeds
 * Google rich results and answer engines (ChatGPT/Perplexity/AI Overviews).
 */

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const messages = (await import(`@/i18n/messages/${locale}.json`)).default;
  const meta = messages.qrMenuPage.meta;

  return {
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords,
    alternates: {
      canonical: `/${locale}/qr-menu`,
      languages: Object.fromEntries(
        locales.map((l) => [localeConfig[l].hreflang, `/${l}/qr-menu`])
      ),
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
    },
  };
}

const FEATURE_ICONS = [Zap, ClipboardList, Languages, Wheat, Palette, LayoutGrid];

export default async function QrMenuPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('qrMenuPage');

  const steps = t.raw('how.steps') as Array<{ title: string; description: string }>;
  const features = t.raw('features.items') as Array<{ title: string; description: string }>;
  const faqItems = t.raw('faq.items') as Array<{ q: string; a: string }>;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://hummytummy.com';

  // Structured data: the FAQ mirrors the visible <details> list 1:1 (a Google
  // requirement), and the SoftwareApplication offer carries price 0 because
  // the QR menu ships in the free core.
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'HummyTummy QR Menu',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: `${baseUrl}/${locale}/qr-menu`,
      description: t('meta.description'),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'TRY' },
      publisher: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <Navbar />
      <main className="min-h-screen bg-white">
        {/* Hero */}
        <section className="relative overflow-hidden pt-32 pb-20 lg:pt-40 lg:pb-28">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <span className="inline-flex items-center rounded-full bg-orange-500/15 px-4 py-1.5 text-sm font-medium text-orange-300 ring-1 ring-orange-500/30">
                  {t('hero.badge')}
                </span>
                <h1 className="mt-6 text-4xl lg:text-5xl font-bold tracking-tight text-white">
                  {t('hero.title')}{' '}
                  <span className="text-orange-400">{t('hero.titleHighlight')}</span>
                </h1>
                <p className="mt-6 text-lg leading-relaxed text-slate-300">
                  {t('hero.subtitle')}
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-4">
                  <a
                    href={appHref('/register')}
                    className="inline-flex items-center justify-center rounded-lg bg-orange-500 px-6 py-3 text-base font-semibold text-white hover:bg-orange-600 transition-colors"
                  >
                    {t('hero.ctaPrimary')}
                  </a>
                  <Link
                    href="/contact"
                    className="inline-flex items-center justify-center rounded-lg border border-slate-600 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    {t('hero.ctaSecondary')}
                  </Link>
                </div>
                <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
                  {[t('hero.trust1'), t('hero.trust2'), t('hero.trust3')].map((badge) => (
                    <li key={badge} className="flex items-center gap-2 text-sm text-slate-300">
                      <Check className="h-4 w-4 shrink-0 text-orange-400" />
                      {badge}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden lg:block">
                <QRMenuMockup />
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 lg:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">
                {t('how.title')}
              </h2>
              <p className="mt-4 text-lg text-slate-600">{t('how.subtitle')}</p>
            </div>
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {steps.map((step, i) => (
                <li
                  key={step.title}
                  className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500 text-lg font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-2 text-slate-600 leading-relaxed">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 lg:py-24 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">
                {t('features.title')}
              </h2>
              <p className="mt-4 text-lg text-slate-600">{t('features.subtitle')}</p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, i) => {
                const Icon = FEATURE_ICONS[i] ?? Zap;
                return (
                  <div
                    key={feature.title}
                    className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 font-semibold text-slate-900">{feature.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600">
                      {feature.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Why free */}
        <section className="py-20 lg:py-24">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">{t('why.title')}</h2>
            <p className="mt-6 text-lg leading-relaxed text-slate-600">{t('why.body1')}</p>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">{t('why.body2')}</p>
          </div>
        </section>

        {/* Coverage */}
        <section className="py-16 bg-slate-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
              <MapPin className="h-5 w-5" />
            </span>
            <h2 className="mt-4 text-2xl lg:text-3xl font-bold text-slate-900">
              {t('coverage.title')}
            </h2>
            <p className="mt-4 text-slate-600 leading-relaxed">{t('coverage.body')}</p>
            <p className="mt-4 text-sm text-slate-500">{t('coverage.cities')}</p>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20 lg:py-24">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900 text-center">
              {t('faq.title')}
            </h2>
            <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {faqItems.map((item) => (
                <details key={item.q} className="group p-6">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-900">
                    {item.q}
                    <span className="text-slate-400 transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-slate-600">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="relative overflow-hidden py-20">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
          <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl lg:text-4xl font-bold text-white">{t('cta.title')}</h2>
            <p className="mt-4 text-lg text-slate-300">{t('cta.subtitle')}</p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
              <a
                href={appHref('/register')}
                className="inline-flex items-center justify-center rounded-lg bg-orange-500 px-6 py-3 text-base font-semibold text-white hover:bg-orange-600 transition-colors"
              >
                {t('cta.primary')}
              </a>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center rounded-lg border border-slate-600 px-6 py-3 text-base font-semibold text-white hover:bg-slate-800 transition-colors"
              >
                {t('cta.secondary')}
              </Link>
            </div>
            <a
              href="tel:+908508407303"
              className="mt-6 inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
            >
              <Phone className="h-4 w-4 text-orange-400" />
              {t('cta.callUs')}: <span dir="ltr">+90 850 840 73 03</span>
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
