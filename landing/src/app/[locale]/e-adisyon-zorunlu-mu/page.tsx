import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { AlertCircle, CheckCircle2, FileText, QrCode, CreditCard } from 'lucide-react';
import {
  LAST_REVIEWED,
  SOURCES,
  VERDICT,
  SECTIONS,
  KAREKOD,
  FAQ,
} from '@/content/e-adisyon';

/**
 * Turkish-only. This page corrects a claim published in Turkish about Turkish
 * tax regulation; there is no audience for a translation and no honest way to
 * machine-translate a regulatory correction.
 */
const PAGE_LOCALE = 'tr' as const;
const PATH = '/e-adisyon-zorunlu-mu';

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
      title: 'e-Adisyon Zorunlu mu? (2026) — Tebliğ ve Duyurularla',
      description:
        'e-Adisyon 25 Ağustos 2026 itibarıyla hiçbir mükellef grubu için zorunlu değildir. 509 No.lu VUK Genel Tebliği IV.12.2 ve IV.12.4 ile GİB duyuru arşivine dayanan, kaynaklı ve tarihli cevap.',
      keywords:
        'e-adisyon zorunlu mu, e-adisyon, adisyon zorunluluğu, 509 nolu tebliğ, e-adisyon geçiş, e-belge karekod, karekodlu fiş, adisyon programı',
    },
  });
}

function markup(text: string) {
  // The content module uses **bold** in a few places; nothing else.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

export default async function EAdisyonPage({ params }: Props) {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) notFound();
  setRequestLocale(locale);

  const baseUrl = siteBaseUrl();
  const url = `${baseUrl}/${PAGE_LOCALE}${PATH}`;

  // FAQPage mirrors the visible list 1:1, which Google requires. Article
  // carries dateModified because a regulatory answer is only as good as the
  // date it was last checked against the source — and because answer engines
  // weight recency on exactly this kind of question.
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'e-Adisyon zorunlu mu? (2026)',
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
      mainEntity: FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  ];

  const KAREKOD_ICONS = [QrCode, FileText, CreditCard];

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
          >
            ← Ana sayfa
          </Link>

          <h1 className="mt-8 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            e-Adisyon zorunlu mu?
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Son kontrol: {LAST_REVIEWED} · Kaynaklar sayfanın sonunda
          </p>

          {/* The answer, first, in full — an answer engine that lifts one
              passage from this page should lift a complete one. */}
          <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
            <div className="flex gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-lg font-semibold text-slate-900">{VERDICT.short}</p>
                <p className="mt-3 text-slate-700 leading-relaxed">{VERDICT.why}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700 leading-relaxed">
              Bu sayfa bilgilendirme amaçlıdır, mali müşavirlik hizmeti değildir.
              Mevzuat değişebilir; yukarıdaki tarih, kaynakların en son kontrol
              edildiği gündür. Kendi durumunuz için mali müşavirinize danışın.
            </p>
          </div>

          {SECTIONS.map((section) => (
            <section key={section.heading} className="mt-12">
              <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-4">
                {section.heading}
              </h2>
              {section.body.map((para, i) => (
                <p key={i} className="text-slate-600 leading-relaxed mb-4">
                  {markup(para)}
                </p>
              ))}
            </section>
          ))}

          <section className="mt-12">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-4">
              {KAREKOD.heading}
            </h2>
            {KAREKOD.body.map((para, i) => (
              <p key={i} className="text-slate-600 leading-relaxed mb-6">
                {markup(para)}
              </p>
            ))}

            <div className="space-y-4">
              {KAREKOD.items.map((item, i) => {
                const Icon = KAREKOD_ICONS[i] ?? QrCode;
                return (
                  <div
                    key={item.title}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-5 flex gap-4"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4 text-orange-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 mb-1">{item.title}</h3>
                      <p className="text-sm text-slate-600 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <dl className="mt-8 space-y-6">
              {KAREKOD.facts.map((fact) => (
                <div key={fact.q}>
                  <dt className="font-semibold text-slate-900 mb-1">{fact.q}</dt>
                  <dd className="text-slate-600 leading-relaxed">{fact.a}</dd>
                </div>
              ))}
            </dl>
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
            <p className="text-sm text-slate-500 mb-4">
              Bu sayfadaki her iddia aşağıdaki birincil kaynaklardan
              doğrulanmıştır. Bağlantılar resmî sitelere gider.
            </p>
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
              Adisyonlarınızı zaten dijital tutuyor olabilirsiniz
            </h2>
            <p className="text-slate-300 leading-relaxed mb-6">
              HummyTummy’de POS/adisyon, mutfak ekranı ve masa yönetimi ücretsiz ve
              sınırsızdır: siparişler masadan girilir, mutfak ekranına düşer, kasada
              kapanır. Bu, e-Adisyon uygulamasına dahil olmakla aynı şey değildir —
              e-Adisyon GİB’e elektronik belge göndermeyi kapsar ve şu anda kimse için
              zorunlu değildir.
            </p>
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
