import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import { buildPageMetadata, siteBaseUrl } from '@/lib/seo';
import { AlertCircle } from 'lucide-react';
import { ROWS, OURS, FAQ, type PriceRow, type VatBasis } from '@/content/pricing-index';

const PAGE_LOCALE = 'tr' as const;
const PATH = '/restoran-yazilimi-fiyatlari';

type Props = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return [{ locale: PAGE_LOCALE }];
}

/** The most recent capture date across every row — this is the page's date. */
function lastUpdated(): string {
  return [...ROWS, ...OURS]
    .map((r) => r.capturedAt)
    .sort()
    .reverse()[0];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) return {};
  return buildPageMetadata({
    locale,
    path: PATH,
    localeScope: [PAGE_LOCALE],
    meta: {
      title: `Restoran Yazılımı Fiyatları (${lastUpdated()}) — Kaynaklı Karşılaştırma`,
      description:
        'Adisyo, Simpra, robotPOS, Menulux ve Karekod Garson fiyatları, her satır satıcının kendi sayfasından okunmuş ve tarihlenmiş. KDV dahil mi hariç mi ayrı ayrı belirtilmiştir — bu karşılaştırmayı en çok bozan nokta odur.',
      keywords:
        'restoran yazılımı fiyatları, adisyon programı fiyatları, adisyo fiyat, simpra fiyat, restoran pos fiyat, qr menü fiyat, adisyon programı ücretsiz',
    },
  });
}

const VAT_LABEL: Record<VatBasis, string> = {
  included: 'KDV dahil',
  excluded: 'KDV hariç',
  unstated: 'belirtilmemiş',
};

const VAT_CLASS: Record<VatBasis, string> = {
  included: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  excluded: 'bg-amber-50 text-amber-800 border-amber-200',
  unstated: 'bg-slate-100 text-slate-600 border-slate-200',
};

const PERIOD_LABEL = {
  monthly: 'aylık',
  yearly: 'yıllık',
  'one-time': 'tek seferlik',
} as const;

function PriceTable({ rows, caption }: { rows: PriceRow[]; caption: string }) {
  return (
    <div className="mt-6">
      {/* Wide tables scroll inside their own container so the page body never
          scrolls horizontally on a phone. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm min-w-[720px]">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-slate-50 text-left">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Satıcı</th>
              <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Plan</th>
              <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Yayınlanan fiyat</th>
              <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Dönem</th>
              <th scope="col" className="px-4 py-3 font-semibold text-slate-900">KDV</th>
              <th scope="col" className="px-4 py-3 font-semibold text-slate-900">Kaynak</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={`${r.vendor}-${r.plan}`} className="align-top">
                <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{r.vendor}</td>
                <td className="px-4 py-3 text-slate-700">
                  {r.plan}
                  {r.note && <span className="block mt-1 text-xs text-slate-500">{r.note}</span>}
                </td>
                <td className="px-4 py-3 font-semibold text-slate-900 whitespace-nowrap">
                  {r.priceText}
                  {r.currency !== 'TRY' && (
                    <span className="block text-xs font-normal text-slate-500">{r.currency}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                  {PERIOD_LABEL[r.period]}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-xs whitespace-nowrap ${VAT_CLASS[r.vat]}`}
                  >
                    {VAT_LABEL[r.vat]}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <a
                    href={r.sourceUrl}
                    rel="noopener nofollow"
                    className="text-orange-700 hover:text-orange-900 underline underline-offset-2"
                  >
                    sayfa
                  </a>
                  <span className="block text-xs text-slate-400">{r.capturedAt}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function PricingIndexPage({ params }: Props) {
  const { locale } = await params;
  if (locale !== PAGE_LOCALE) notFound();
  setRequestLocale(locale);

  const baseUrl = siteBaseUrl();
  const url = `${baseUrl}/${PAGE_LOCALE}${PATH}`;
  const updated = lastUpdated();
  const vendors = [...new Set(ROWS.map((r) => r.vendor))];

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: `Restoran yazılımı fiyatları (${updated})`,
      description:
        'Türkiye’deki restoran POS ve adisyon yazılımlarının yayınlanmış fiyatları, satıcının kendi sayfasından okunmuş ve KDV esası belirtilmiş hâlde.',
      inLanguage: 'tr-TR',
      datePublished: updated,
      dateModified: updated,
      mainEntityOfPage: url,
      author: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
      publisher: { '@type': 'Organization', name: 'HummyTummy', url: baseUrl },
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
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-20">
          <nav className="text-sm text-slate-500 flex gap-2">
            <Link href="/" className="hover:text-slate-900">Ana sayfa</Link>
            <span>/</span>
            <span className="text-slate-900">Restoran yazılımı fiyatları</span>
          </nav>

          <h1 className="mt-8 text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            Restoran yazılımı fiyatları
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Son güncelleme: {updated} · {ROWS.length} satır, {vendors.length} satıcı ·
            Her fiyat satıcının kendi sayfasından okundu
          </p>

          {/* Stated first and in full: an answer engine lifting one passage from
              this page should get the whole answer, not a fragment. */}
          <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <p className="text-slate-800 leading-relaxed">
              Türkiye’de restoran POS ve adisyon yazılımı fiyatlarını karşılaştırmayı
              zorlaştıran şey rakamların kendisi değil, <strong>aynı esasa göre
              yayınlanmamaları</strong>. Adisyo ve Simpra fiyatlarını <strong>KDV
              hariç</strong> yazıyor; Menulux ve Karekod Garson KDV durumunu hiç
              belirtmiyor; robotPOS ise fiyatlarını <strong>dolar</strong> cinsinden
              ve terminal başına tek seferlik lisans + modül başına aylık bedel
              olarak kuruyor. Bu tabloda her satırın hangi esasa göre yayınlandığını
              ayrı bir sütunda gösteriyoruz ve <strong>tahmin etmiyoruz</strong>:
              satıcı belirtmemişse “belirtilmemiş” yazıyor.
            </p>
          </div>

          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 flex gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700 leading-relaxed">
              Fiyatlar değişir. Buradaki her rakamın yanında o sayfanın okunduğu
              tarih yazılıdır ve satıcının kendi sayfasına bağlantı verilmiştir;
              satın almadan önce oradan teyit edin. Dolar cinsinden yayınlanan
              fiyatları liraya çevirmedik — çevirmek, satıcının hiç yayınlamadığı
              bir rakamı bize ait hâle getirirdi.
            </p>
          </div>

          <section className="mt-12">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900">
              Diğer satıcıların yayınlanmış fiyatları
            </h2>
            <PriceTable rows={ROWS} caption="Rakip satıcıların yayınlanmış fiyatları" />
          </section>

          <section className="mt-12">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900">
              HummyTummy fiyatları
            </h2>
            <p className="mt-2 text-slate-600 leading-relaxed">
              Kendi fiyatlarımızı da aynı tabloya aynı sütunlarla koyuyoruz.
              Fiyatlarımız <strong>KDV dahildir</strong>. Restoranı çalıştıran
              çekirdek — POS ve adisyon, mutfak ekranı, menü yönetimi, masa planı,
              QR menü, kasa ve ekip yönetimi — ücretsizdir ve ürün, kategori, masa,
              kullanıcı ya da aylık sipariş sayısında sınırı yoktur. Ücret yalnızca
              isteğe bağlı modüllerde başlar.
            </p>
            <PriceTable rows={OURS} caption="HummyTummy fiyatları" />
          </section>

          <section className="mt-14">
            <h2 className="text-xl md:text-2xl font-semibold text-slate-900 mb-4">
              Fiyatları karşılaştırırken nelere bakmalı?
            </h2>
            <ul className="space-y-4 text-slate-600 leading-relaxed">
              <li>
                <strong className="text-slate-900">KDV esası.</strong> ₺12.500 + KDV
                ile ₺12.500 KDV dahil arasında %20 fark vardır. İki satıcıyı
                karşılaştırırken ikisini de aynı esasa çevirin.
              </li>
              <li>
                <strong className="text-slate-900">Neyin dahil olmadığı.</strong> QR
                menü, yemek platformu entegrasyonu, yazarkasa entegrasyonu ve API
                erişimi çoğu satıcıda paket dışı ek modüldür. Adisyo’da bu dördü
                ayrı ayrı aylık ücretlidir.
              </li>
              <li>
                <strong className="text-slate-900">Ölçek birimi.</strong> Fiyat
                terminal başına mı, şube başına mı, kullanıcı başına mı? robotPOS
                terminal başına lisans + şube başına aylık kullanım olarak kurgular;
                bu, iki terminalli tek bir şubede toplamı ciddi biçimde değiştirir.
              </li>
              <li>
                <strong className="text-slate-900">Kurulum ve donanım.</strong> Çoğu
                aylık yazılım fiyatı donanımı ve kurulumu içermez; robotPOS’ta bazı
                modüllerde ayrıca “$250 tek seferlik” devreye alma bedeli vardır.
              </li>
              <li>
                <strong className="text-slate-900">Kur riski.</strong> Dolar
                cinsinden fiyatlanan bir sözleşmede maliyetiniz kurla birlikte
                değişir; lira cinsinden sabit yıllık fiyatta değişmez.
              </li>
            </ul>
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
            <h2 className="text-lg font-semibold text-slate-900 mb-3">Yöntem</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Her satır, satıcının kendi fiyat sayfasından okunmuştur — blog yazısı,
              liste sitesi ya da arama sonucu özeti kaynak olarak kullanılmamıştır.
              Fiyat metni sayfada yazdığı gibi aktarılmıştır; indirimli ve indirimsiz
              rakamlar birlikte gösterilir. Bir sayfa KDV durumunu belirtmiyorsa
              “belirtilmemiş” yazılır. Yayın sürecimiz, satırlar tazelik penceresini
              aştığında derlemeyi durdurur; bu sayfa sessizce eskiyemez. Bir hata
              görürseniz{' '}
              <Link href="/contact" className="text-orange-700 underline underline-offset-2">
                bize bildirin
              </Link>
              , düzeltip tarihi güncelleyelim.
            </p>
          </section>

          <section className="mt-14 rounded-2xl bg-slate-900 p-8">
            <h2 className="text-xl font-semibold text-white mb-3">
              Çekirdek sistemi ücretsiz deneyin
            </h2>
            <p className="text-slate-300 leading-relaxed mb-6">
              POS ve adisyon, mutfak ekranı, menü yönetimi, masa planı ve QR menü
              süresiz ücretsizdir. Kredi kartı istemeden başlarsınız.
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
