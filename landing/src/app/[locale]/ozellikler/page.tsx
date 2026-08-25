import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { MODULES } from '@/content/catalog';
import { MODULE_CONTENT } from '@/content/modules';

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
    path: '/ozellikler',
    localeScope: [PAGE_LOCALE],
    meta: {
      title: 'Özellikler — Restoran POS, Adisyon, Mutfak Ekranı ve Daha Fazlası',
      description:
        'HummyTummy’nin restoran yönetim modülleri: QR menü, POS ve adisyon, masa ve sipariş yönetimi, mutfak ekranı (KDS), stok, çoklu şube, e-Fatura ve donanım. Çekirdek modüller ücretsiz ve sınırsız.',
      keywords:
        'restoran yazılımı özellikleri, adisyon programı özellikleri, restoran pos modülleri, mutfak ekranı, kds, stok takibi restoran',
    },
  });
}

export default async function ModulesIndexPage({ params }: Props) {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) notFound();
  setRequestLocale(locale);

  const baseUrl = siteBaseUrl();
  // Modules with a page of their own, plus the ones that defer to a richer
  // standalone page. Hidden modules are absent by construction.
  const linkable = MODULES.filter((m) => !m.hidden).map((m) => ({
    ...m,
    href: m.redirectTo ?? `/ozellikler/${m.slug}`,
    live: !!m.redirectTo || !!MODULE_CONTENT[m.slug],
  }));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'HummyTummy restoran yönetim modülleri',
    itemListElement: linkable
      .filter((m) => m.live)
      .map((m, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: m.title,
        description: m.tagline,
        url: `${baseUrl}/${PAGE_LOCALE}${m.href}`,
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
            <span className="text-slate-900">Özellikler</span>
          </nav>

          <h1 className="mt-8 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            Restoranı çalıştıran her şey, tek sistemde
          </h1>
          <p className="mt-4 text-lg text-slate-600 leading-relaxed">
            POS ve adisyon, mutfak ekranı, menü yönetimi, masa planı ve QR menü
            ücretsiz ve sınırsızdır. Ağır modülleri ihtiyaç duydukça yıllık
            eklersiniz. Her modülün ne yaptığını aşağıdan tek tek okuyabilirsiniz.
          </p>

          <ul className="mt-10 grid sm:grid-cols-2 gap-4">
            {linkable.map((m) =>
              m.live ? (
                <li key={m.slug}>
                  <Link
                    href={m.href}
                    className="block h-full rounded-2xl border border-slate-200 p-5 hover:border-orange-300 hover:shadow-sm transition-all"
                  >
                    <h2 className="font-semibold text-slate-900">{m.title}</h2>
                    <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                      {m.tagline}
                    </p>
                  </Link>
                </li>
              ) : (
                <li
                  key={m.slug}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                >
                  <h2 className="font-semibold text-slate-900">{m.title}</h2>
                  <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                    {m.tagline}
                  </p>
                </li>
              ),
            )}
          </ul>

          <section className="mt-14">
            <h2 className="text-xl font-semibold text-slate-900 mb-4">
              İşletme türüne göre
            </h2>
            <p className="text-slate-600 mb-5">
              Aynı sistemin restoranda, kafede, pastanede ve bulut mutfakta nasıl
              kurulduğunu görün.
            </p>
            <Link
              href="/cozumler"
              className="inline-flex items-center gap-2 text-orange-700 hover:text-orange-900 font-medium"
            >
              Çözümlere göz atın →
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
