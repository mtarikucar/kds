import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { appHref } from '@/lib/urls';
import { locales, localeConfig } from '@/i18n/config';
import {
  Inbox,
  ChefHat,
  Store,
  PhoneCall,
  BarChart3,
  ReceiptText,
  Check,
  Phone,
} from 'lucide-react';

/**
 * SEO landing page for cloud kitchens / delivery-heavy restaurants
 * ("bulut mutfak" — the Turkish slug is deliberate, tr is the target
 * market; /cloud-kitchen 308s here via middleware). Showcases the
 * Yemeksepeti / Getir / Trendyol / Migros Yemek order aggregation into
 * one feed + kitchen display. Static per-locale, structured data below.
 */

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const messages = (await import(`@/i18n/messages/${locale}.json`)).default;
  const meta = messages.cloudKitchenPage.meta;

  return {
    title: meta.title,
    description: meta.description,
    keywords: meta.keywords,
    alternates: {
      canonical: `/${locale}/bulut-mutfak`,
      languages: Object.fromEntries(
        locales.map((l) => [localeConfig[l].hreflang, `/${l}/bulut-mutfak`])
      ),
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
    },
  };
}

const FEATURE_ICONS = [Inbox, ChefHat, Store, PhoneCall, BarChart3, ReceiptText];

// Brand initial + accent per platform card (no third-party logos on purpose).
const PLATFORM_ACCENTS = [
  'bg-rose-50 text-rose-600',
  'bg-purple-50 text-purple-600',
  'bg-amber-50 text-amber-600',
  'bg-emerald-50 text-emerald-600',
];

export default async function CloudKitchenPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cloudKitchenPage');

  const platforms = t.raw('platforms.items') as Array<{ name: string; description: string }>;
  const features = t.raw('features.items') as Array<{ title: string; description: string }>;
  const faqItems = t.raw('faq.items') as Array<{ q: string; a: string }>;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://hummytummy.com';

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'HummyTummy Cloud Kitchen',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: `${baseUrl}/${locale}/bulut-mutfak`,
      description: t('meta.description'),
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
          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <span className="inline-flex items-center rounded-full bg-orange-500/15 px-4 py-1.5 text-sm font-medium text-orange-300 ring-1 ring-orange-500/30">
              {t('hero.badge')}
            </span>
            <h1 className="mt-6 text-4xl lg:text-5xl font-bold tracking-tight text-white">
              {t('hero.title')}{' '}
              <span className="text-orange-400">{t('hero.titleHighlight')}</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">{t('hero.subtitle')}</p>
            <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
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
            <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
              {[t('hero.trust1'), t('hero.trust2'), t('hero.trust3')].map((badge) => (
                <li key={badge} className="flex items-center gap-2 text-sm text-slate-300">
                  <Check className="h-4 w-4 shrink-0 text-orange-400" />
                  {badge}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Pain */}
        <section className="py-20 lg:py-24">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">{t('pain.title')}</h2>
            <p className="mt-6 text-lg leading-relaxed text-slate-600">{t('pain.body')}</p>
          </div>
        </section>

        {/* Platforms */}
        <section className="py-20 lg:py-24 bg-slate-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">
                {t('platforms.title')}
              </h2>
              <p className="mt-4 text-lg text-slate-600">{t('platforms.subtitle')}</p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {platforms.map((platform, i) => (
                <div
                  key={platform.name}
                  className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold ${PLATFORM_ACCENTS[i % PLATFORM_ACCENTS.length]}`}
                  >
                    {platform.name.charAt(0)}
                  </span>
                  <h3 className="mt-4 font-semibold text-slate-900">{platform.name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">
                    {platform.description}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-slate-500">{t('platforms.note')}</p>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 lg:py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">
                {t('features.title')}
              </h2>
              <p className="mt-4 text-lg text-slate-600">{t('features.subtitle')}</p>
            </div>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, i) => {
                const Icon = FEATURE_ICONS[i] ?? Inbox;
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

        {/* FAQ */}
        <section className="py-20 lg:py-24 bg-slate-50">
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
