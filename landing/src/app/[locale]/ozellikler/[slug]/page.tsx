import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { Check } from 'lucide-react';
import { MODULE_CONTENT } from '@/content/modules';
import { MODULES } from '@/content/catalog';

/**
 * Module deep-dive pages, ported from the apex SPA where they were served
 * inside a client-rendered shell and therefore invisible to every crawler.
 * Turkish-only — see src/content/modules.ts.
 */
const PAGE_LOCALE = 'tr' as const;

type Props = { params: Promise<{ locale: string; slug: string }> };

/** Modules that ship a page: has copy, not hidden, not deferring to another page. */
export const PUBLISHED_MODULES = MODULES.filter(
  (m) => m.hasDeepDive && !m.hidden && !m.redirectTo && MODULE_CONTENT[m.slug],
);

export function generateStaticParams() {
  return PUBLISHED_MODULES.map((m) => ({ locale: PAGE_LOCALE, slug: m.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const meta = MODULES.find((m) => m.slug === slug);
  const copy = MODULE_CONTENT[slug];
  if (locale !== PAGE_LOCALE || !meta || !copy) return {};
  return buildPageMetadata({
    locale,
    path: `/ozellikler/${slug}`,
    localeScope: [PAGE_LOCALE],
    meta: {
      // The hero title is written as a sentence and is often long; the meta
      // title has to survive being shown as a search result on its own, so it
      // leads with the module name.
      title: `${meta.title} — Restoran Yazılımı Özelliği`,
      description: copy.hero.subtitle.slice(0, 300),
    },
  });
}

export default async function ModulePage({ params }: Props) {
  const { locale, slug } = await params;
  if (locale !== PAGE_LOCALE) notFound();

  const meta = MODULES.find((m) => m.slug === slug);
  // A module that defers to a richer standalone page redirects there rather
  // than competing with it for the same queries.
  if (meta?.redirectTo) redirect(`/${PAGE_LOCALE}${meta.redirectTo}`);

  const copy = MODULE_CONTENT[slug];
  if (!meta || !copy || meta.hidden) notFound();

  setRequestLocale(locale);
  const baseUrl = siteBaseUrl();
  const url = `${baseUrl}/${PAGE_LOCALE}/ozellikler/${slug}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: copy.hero.title,
      description: copy.hero.subtitle,
      inLanguage: 'tr-TR',
      mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
      publisher: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Ana sayfa', item: `${baseUrl}/${PAGE_LOCALE}` },
        { '@type': 'ListItem', position: 2, name: 'Özellikler', item: `${baseUrl}/${PAGE_LOCALE}/ozellikler` },
        { '@type': 'ListItem', position: 3, name: meta.title, item: url },
      ],
    },
    ...(copy.faq.length
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: copy.faq.map((f) => ({
              '@type': 'Question',
              name: f.q,
              acceptedAnswer: { '@type': 'Answer', text: f.a },
            })),
          },
        ]
      : []),
  ];

  const related = PUBLISHED_MODULES.filter((m) => m.slug !== slug).slice(0, 4);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
          <nav className="text-sm text-slate-500 flex gap-2 flex-wrap">
            <Link href="/" className="hover:text-slate-900">Ana sayfa</Link>
            <span>/</span>
            <Link href="/ozellikler" className="hover:text-slate-900">Özellikler</Link>
            <span>/</span>
            <span className="text-slate-900">{meta.title}</span>
          </nav>

          <span className="mt-8 inline-block text-sm font-semibold text-orange-600 uppercase tracking-wider">
            {copy.hero.eyebrow}
          </span>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            {copy.hero.title}
          </h1>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">{copy.hero.subtitle}</p>

          {/* Free core or paid add-on, stated before the sales copy rather than
              left to be discovered at checkout. Several of these pages read as
              though the module were included; the reports one is the sharpest
              case, since every /reports/* route is @RequiresFeature-gated. */}
          <p className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm">
            {meta.pricing.kind === 'free' ? (
              <>
                <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-slate-700">
                  <strong className="text-slate-900">Ücretsiz çekirdeğe dahil.</strong>{' '}
                  Lisans gerekmez, kullanım sınırı yoktur.
                </span>
              </>
            ) : (
              <span className="text-slate-700">
                <strong className="text-slate-900">Yıllık modül — {meta.pricing.priceLabel}.</strong>{' '}
                Ücretli modülleri kullanabilmek için yıllık Bakım, Destek ve
                Güncelleme lisansı da gerekir. Çekirdek sistem bu modül olmadan
                da tam çalışır.
              </span>
            )}
          </p>

          <p className="mt-8 text-slate-600 leading-relaxed">{copy.intro}</p>

          {copy.blocks.map((block) => (
            <section key={block.title} className="mt-12">
              <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-4">
                {block.title}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-5">{block.body}</p>
              <ul className="space-y-2.5">
                {block.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-slate-700">
                    <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {copy.how.steps.length > 0 && (
            <section className="mt-14">
              <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-6">
                {copy.how.heading}
              </h2>
              <ol className="space-y-6">
                {copy.how.steps.map((step, i) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 font-semibold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold text-slate-900 mb-1">{step.title}</h3>
                      <p className="text-slate-600 leading-relaxed">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {copy.advantages.length > 0 && (
            <section className="mt-14">
              <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-5">
                Öne çıkanlar
              </h2>
              <ul className="grid sm:grid-cols-2 gap-3">
                {copy.advantages.map((a) => (
                  <li
                    key={a}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
                  >
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {copy.faq.length > 0 && (
            <section className="mt-14">
              <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-6">
                Sık sorulanlar
              </h2>
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                {copy.faq.map((item) => (
                  <details key={item.q} className="group py-4">
                    <summary className="cursor-pointer font-medium text-slate-900 marker:content-none flex justify-between gap-4">
                      {item.q}
                      <span className="text-slate-400 group-open:rotate-45 transition-transform shrink-0">
                        +
                      </span>
                    </summary>
                    <p className="mt-3 text-slate-600 leading-relaxed">{item.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}

          {related.length > 0 && (
            <section className="mt-14">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">İlgili özellikler</h2>
              <ul className="grid sm:grid-cols-2 gap-3">
                {related.map((m) => (
                  <li key={m.slug}>
                    <Link
                      href={`/ozellikler/${m.slug}`}
                      className="block rounded-xl border border-slate-200 p-4 hover:border-orange-300 transition-colors"
                    >
                      <span className="font-medium text-slate-900">{m.title}</span>
                      <span className="block text-sm text-slate-500 mt-1">{m.tagline}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-14 rounded-2xl bg-slate-900 p-8">
            <h2 className="text-xl font-semibold text-white mb-4">{copy.ctaTitle}</h2>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 font-semibold text-slate-900 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl hover:from-amber-500 hover:to-orange-500 transition-all"
            >
              Ücretsiz başlayın
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
