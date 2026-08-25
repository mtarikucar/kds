import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { SECTORS } from '@/content/catalog';
import { SECTOR_CONTENT } from '@/content/sectors';

const PAGE_LOCALE = 'tr' as const;

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return [{ locale: PAGE_LOCALE }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) return {};
  return buildPageMetadata({
    locale,
    path: '/cozumler',
    localeScope: [PAGE_LOCALE],
    meta: {
      title: 'Çözümler — Restoran, Kafe, Bar, Pastane ve Bulut Mutfak',
      description:
        'Aynı sistemin işletme türüne göre kurulumu: restoran, kafe, bar, pastane ve fırın, fast food, pizza, burger, şubeli zincir ve bulut mutfak. Her biri için öne çıkan modüller ve gerçek kullanım akışı.',
      keywords:
        'restoran programı, kafe programı, bar programı, pastane programı, fast food pos, bulut mutfak yazılımı, zincir restoran yazılımı',
    },
  });
}

export default async function SectorsIndexPage({ params }: Props) {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) notFound();
  setRequestLocale(locale);

  const baseUrl = siteBaseUrl();
  const published = SECTORS.filter((s) => SECTOR_CONTENT[s.slug]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'İşletme türüne göre HummyTummy çözümleri',
    itemListElement: published.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.title,
      url: `${baseUrl}/${PAGE_LOCALE}/cozumler/${s.slug}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
          <nav className="text-sm text-slate-500 flex gap-2">
            <Link href="/" className="hover:text-slate-900">Ana sayfa</Link>
            <span>/</span>
            <span className="text-slate-900">Çözümler</span>
          </nav>

          <h1 className="mt-8 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            İşletmenize göre kurulmuş bir sistem
          </h1>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">
            Bir bar ile bir pastane aynı yazılımı aynı şekilde kullanmaz. Aşağıda
            her işletme türü için hangi modüllerin öne çıktığını ve günlük akışın
            nasıl kurulduğunu anlattık.
          </p>

          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {published.map((s) => (
              <li key={s.slug}>
                <Link
                  href={`/cozumler/${s.slug}`}
                  className="block h-full rounded-2xl border border-slate-200 p-5 hover:border-orange-300 hover:shadow-sm transition-all"
                >
                  <span className="text-2xl" aria-hidden>{s.emoji}</span>
                  <h2 className="mt-2 font-semibold text-slate-900">{s.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {s.title} için POS, adisyon ve mutfak akışı
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <section className="mt-14">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">
              Modüllerin tamamı
            </h2>
            <Link
              href="/ozellikler"
              className="inline-flex items-center gap-2 text-orange-700 hover:text-orange-900 font-medium"
            >
              Özelliklere göz atın →
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
