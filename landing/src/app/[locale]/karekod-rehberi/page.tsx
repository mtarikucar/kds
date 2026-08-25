import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { AlertCircle, QrCode, FileText, CreditCard } from 'lucide-react';
import {
  LAST_REVIEWED,
  SOURCES,
  LEAD,
  KINDS,
  CONTRADICTION,
  FAQ,
} from '@/content/karekod';

const PAGE_LOCALE = 'tr' as const;
const PATH = '/karekod-rehberi';
const ICONS = [QrCode, FileText, CreditCard];

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return [{ locale: PAGE_LOCALE }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) return {};
  return buildPageMetadata({
    locale,
    path: PATH,
    localeScope: [PAGE_LOCALE],
    meta: {
      title: 'Karekod Rehberi — Karekod Menü, e-Belge Karekodu ve TR Karekod',
      description:
        'Restoranda “karekod” üç ayrı şeyi anlatır: karekod menü, e-Belgelerdeki GİB karekodu ve ödemelerde TR Karekod. Hangisi zorunlu, hangisi değil — tebliğ ve duyurulara dayanarak, kaynaklarıyla.',
      keywords:
        'karekod, fiş karekod, karekodlu fiş, e-fatura karekod, karekod zorunluluğu, tr karekod, karekod menü, qr menü, e-belge karekod',
    },
  });
}

export default async function KarekodGuidePage({ params }: Props) {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) notFound();
  setRequestLocale(locale);

  const baseUrl = siteBaseUrl();
  const url = `${baseUrl}/${PAGE_LOCALE}${PATH}`;

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'Karekod rehberi: karekod menü, e-Belge karekodu ve TR Karekod',
      description: LEAD.answer.slice(0, 300),
      inLanguage: 'tr-TR',
      datePublished: LAST_REVIEWED,
      dateModified: LAST_REVIEWED,
      mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
      publisher: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
      citation: SOURCES.map((s) => ({
        '@type': 'CreativeWork',
        name: s.label,
        url: s.url,
        publisher: { '@type': 'Organization', name: s.publisher },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
          <nav className="text-sm text-slate-500 flex gap-2">
            <Link href="/" className="hover:text-slate-900">Ana sayfa</Link>
            <span>/</span>
            <span className="text-slate-900">Karekod rehberi</span>
          </nav>

          <h1 className="mt-8 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            {LEAD.question}
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Son kontrol: {LAST_REVIEWED} · Kaynaklar sayfanın sonunda
          </p>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <p className="text-slate-800 leading-relaxed">{LEAD.answer}</p>
          </div>

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700 leading-relaxed">
              Bu sayfa bilgilendirme amaçlıdır, mali müşavirlik hizmeti değildir.
              Mevzuat değişebilir; yukarıdaki tarih kaynakların en son kontrol
              edildiği gündür.
            </p>
          </div>

          {KINDS.map((kind, i) => {
            const Icon = ICONS[i] ?? QrCode;
            return (
              <section key={kind.id} id={kind.id} className="mt-12">
                <div className="flex gap-4 items-start">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-orange-600" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl md:text-2xl font-semibold text-slate-900">
                      {i + 1}. {kind.name}
                    </h2>
                    <p className="mt-1 text-slate-600">{kind.oneLine}</p>
                  </div>
                </div>

                <dl className="mt-5 grid sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Zorunluluk</dt>
                    <dd className="mt-1 font-medium text-slate-900">{kind.mandatory}</dd>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Dayanak</dt>
                    <dd className="mt-1 font-medium text-slate-900">{kind.regulation}</dd>
                  </div>
                </dl>

                {kind.detail.map((para, j) => (
                  <p key={j} className="mt-4 text-slate-600 leading-relaxed">
                    {para}
                  </p>
                ))}
              </section>
            );
          })}

          <section className="mt-14 rounded-2xl border border-slate-300 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              {CONTRADICTION.heading}
            </h2>
            {CONTRADICTION.body.map((para, i) => (
              <p key={i} className="text-slate-600 leading-relaxed mb-3 last:mb-0">
                {para}
              </p>
            ))}
          </section>

          <section className="mt-12 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              Peki e-Adisyon zorunlu mu?
            </h2>
            <p className="text-slate-700 leading-relaxed">
              Ayrı bir soru ve ayrı bir sayfada cevaplıyoruz. Kısa cevap: hayır —
              e-Adisyon uygulaması hiçbir mükellef grubu için zorunlu kılınmamıştır,
              piyasadaki yaygın bilginin aksine.
            </p>
            <Link
              href="/e-adisyon-zorunlu-mu"
              className="mt-4 inline-flex items-center gap-2 font-medium text-orange-700 hover:text-orange-900"
            >
              e-Adisyon zorunlu mu? sayfasına gidin →
            </Link>
          </section>

          <section className="mt-14">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-6">
              Sık sorulanlar
            </h2>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {FAQ.map((item) => (
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

          <section className="mt-14">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-4">
              Kaynaklar
            </h2>
            <ul className="space-y-3">
              {SOURCES.map((s) => (
                <li key={s.url} className="text-sm">
                  <a
                    href={s.url}
                    rel="noopener nofollow"
                    className="text-orange-700 hover:text-orange-900 underline underline-offset-2"
                  >
                    {s.label}
                  </a>
                  <span className="text-slate-400"> — {s.publisher}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-14 rounded-2xl bg-slate-900 p-8">
            <h2 className="text-xl font-semibold text-white mb-3">
              Karekod menünüz ücretsiz
            </h2>
            <p className="text-slate-300 leading-relaxed mb-6">
              Bu sayfadaki üç karekoddan yalnızca ilki bizim işimiz: HummyTummy’de
              karekod menü çekirdeğin parçasıdır ve ücretsizdir — ürün, kategori ve
              masa sınırı yoktur.
            </p>
            <Link
              href="/qr-menu"
              className="inline-flex items-center gap-2 px-6 py-3 font-semibold text-slate-900 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl hover:from-amber-500 hover:to-orange-500 transition-all"
            >
              Karekod menüyü inceleyin
            </Link>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
