import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { Check } from 'lucide-react';
import { SECTOR_CONTENT } from '@/content/sectors';
import { MODULE_CONTENT } from '@/content/modules';
import { SECTORS, MODULES } from '@/content/catalog';

/**
 * Sector solution pages, ported from the apex SPA. Each reframes the same
 * product for one business type and links the modules that matter most to it.
 * Turkish-only — see src/content/sectors.ts.
 */
const PAGE_LOCALE = 'tr' as const;

type Props = { params: Promise<{ locale: string; slug: string }> };

export const PUBLISHED_SECTORS = SECTORS.filter((s) => SECTOR_CONTENT[s.slug]);

export function generateStaticParams() {
  return PUBLISHED_SECTORS.map((s) => ({ locale: PAGE_LOCALE, slug: s.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const meta = SECTORS.find((s) => s.slug === slug);
  const copy = SECTOR_CONTENT[slug];
  if (locale !== PAGE_LOCALE || !meta || !copy) return {};
  return buildPageMetadata({
    locale,
    path: `/cozumler/${slug}`,
    localeScope: [PAGE_LOCALE],
    meta: {
      title: `${meta.title} Programı — POS, Adisyon ve Mutfak Ekranı`,
      description: copy.hero.subtitle.slice(0, 300),
    },
  });
}

export default async function SectorPage({ params }: Props) {
  const { locale, slug } = await params;
  if (locale !== PAGE_LOCALE) notFound();

  const meta = SECTORS.find((s) => s.slug === slug);
  const copy = SECTOR_CONTENT[slug];
  if (!meta || !copy) notFound();

  setRequestLocale(locale);
  const baseUrl = siteBaseUrl();
  const url = `${baseUrl}/${PAGE_LOCALE}/cozumler/${slug}`;

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
        { '@type': 'ListItem', position: 2, name: 'Çözümler', item: `${baseUrl}/${PAGE_LOCALE}/cozumler` },
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

  // The sector's own curated module list, filtered to the ones that ship a page.
  const related = meta.moduleSlugs
    .map((ms) => MODULES.find((m) => m.slug === ms))
    .filter(
      (m): m is NonNullable<typeof m> =>
        !!m && !m.hidden && !m.redirectTo && !!MODULE_CONTENT[m.slug],
    )
    .slice(0, 4);

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
            <Link href="/cozumler" className="hover:text-slate-900">Çözümler</Link>
            <span>/</span>
            <span className="text-slate-900">{meta.emoji} {meta.title}</span>
          </nav>

          <span className="mt-8 inline-block text-sm font-semibold text-orange-600 uppercase tracking-wider">
            {copy.hero.eyebrow}
          </span>
          <h1 className="mt-3 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            {copy.hero.title}
          </h1>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">{copy.hero.subtitle}</p>

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

          {copy.why.length > 0 && (
            <section className="mt-14">
              <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-5">
                {meta.title} işletmeleri için neden HummyTummy?
              </h2>
              <ul className="space-y-2.5">
                {copy.why.map((w) => (
                  <li key={w} className="flex gap-3 text-slate-700">
                    <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{w}</span>
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
              <h2 className="text-lg font-semibold text-slate-900 mb-4">
                {meta.title} için öne çıkan özellikler
              </h2>
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
