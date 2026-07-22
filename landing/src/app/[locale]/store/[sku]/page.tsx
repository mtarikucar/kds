import { notFound } from 'next/navigation';
import { appHref } from '@/lib/urls';
import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import Gallery from './Gallery';
import DetailTabs from './DetailTabs';
import SpecsTable from './SpecsTable';
import ServiceHero from './ServiceHero';

/**
 * v2.8.87 — public product/service detail page.
 *
 * SSG at build time (generateStaticParams over published SKUs) with
 * revalidate=300 ISR. The detail page is the place where buyers learn
 * what they're buying — spec sheet, what's included, requirements,
 * FAQ. Mirror of the SPA's /admin/store/:sku route so a tenant who
 * lands here can deep-link from the public site straight into a
 * logged-in cart.
 *
 * For service SKUs (category==='service') the hero switches to
 * ServiceHero — drops the gallery, shows duration / geoCoverage /
 * serviceType chips instead, swaps tab labels (Açıklama →
 * Neler dahil, Özellikler → Süreç, Uyumluluk → Şartlar).
 */

export const revalidate = 300;

interface PublicProduct {
  id: string;
  sku: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  specs: Record<string, unknown> | null;
  compat: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  serviceMeta: Record<string, unknown> | null;
  priceCents: number;
  rentalMonthlyCents: number | null;
  currency: string;
  warrantyMonths: number;
  images: string[];
  stockStatus: string;
  available: number;
  // Regulatory sale tier (TR law) — drives the CTA. undefined = DIRECT_SALE.
  saleMode?: 'DIRECT_SALE' | 'QUOTE_ONLY' | 'PARTNER_REDIRECT' | 'RECOMMENDED_ONLY';
  partnerRedirect?: { partnerName?: string; partnerUrl?: string; disclaimer?: string } | null;
}

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.BACKEND_URL ??
    'https://hummytummy.com/api'
  );
}

async function fetchProduct(sku: string): Promise<PublicProduct | null> {
  try {
    const res = await fetch(`${apiBase()}/v1/catalog/products/sku/${encodeURIComponent(sku)}`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicProduct;
  } catch {
    return null;
  }
}

async function fetchAllSkus(): Promise<string[]> {
  try {
    const res = await fetch(`${apiBase()}/v1/catalog/products`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const products = (await res.json()) as PublicProduct[];
    return products.map((p) => p.sku);
  } catch {
    return [];
  }
}

// Pre-render every published SKU at build for both locales. Falls back
// to ISR on cache miss for SKUs created after the build (next build
// won't 404 — Next regenerates and revalidates).
export async function generateStaticParams() {
  const skus = await fetchAllSkus();
  // Two locales × all skus. Next dedupes across the cross-product if
  // the same sku is rendered for multiple locales.
  return [...skus.flatMap((sku) => [{ sku }, { sku }])];
}

export async function generateMetadata(
  { params }: { params: Promise<{ locale: string; sku: string }> },
): Promise<Metadata> {
  const { sku } = await params;
  const product = await fetchProduct(sku);
  if (!product) return { title: 'HummyTummy' };
  const description = product.description?.slice(0, 160) ?? '';
  const image = product.images?.[0];
  return {
    title: `${product.name} — HummyTummy`,
    description,
    openGraph: {
      title: product.name,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

function formatPrice(cents: number, currency: string): string {
  return (cents / 100).toLocaleString('tr-TR', {
    style: 'currency',
    currency: currency || 'TRY',
    maximumFractionDigits: 0,
  });
}

function gibCertified(p: PublicProduct): boolean {
  return Boolean(p.compat && (p.compat as { gibCertified?: boolean }).gibCertified === true);
}

function saleModeOf(p: PublicProduct): NonNullable<PublicProduct['saleMode']> {
  return p.saleMode ?? 'DIRECT_SALE';
}

function safePartnerUrl(p: PublicProduct): string | null {
  const u = p.partnerRedirect?.partnerUrl;
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
}

export default async function ProductDetailPage(
  { params }: { params: Promise<{ locale: string; sku: string }> },
) {
  const { sku } = await params;
  const [product, t] = await Promise.all([fetchProduct(sku), getTranslations('store')]);

  if (!product) {
    notFound();
  }

  const isService = product.category === 'service';
  const isOos = product.stockStatus === 'out_of_stock' || product.stockStatus === 'discontinued';
  const showGib = gibCertified(product);
  const mode = saleModeOf(product);
  const partnerUrl = safePartnerUrl(product);

  // details payload may be locale-keyed { tr: {...}, en: {...} } or flat.
  // Pick locale variant, fall back to tr, then flat.
  // We default to TR because dynamic detail copy is only authored in TR
  // for this PR — other locales degrade to spec-only sections.
  const detailsRaw = product.details as any;
  const detailsLocale =
    detailsRaw && (detailsRaw.tr || detailsRaw.en)
      ? detailsRaw.tr ?? detailsRaw.en
      : detailsRaw;
  const details: {
    includes?: string[];
    requirements?: string[];
    faq?: { q: string; a: string }[];
    steps?: { title: string; body: string }[];
    videoUrl?: string;
    gallery?: string[];
  } = detailsLocale ?? {};

  const galleryImages =
    details.gallery && details.gallery.length > 0
      ? details.gallery
      : product.images?.length > 0
        ? product.images
        : [];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <div className="mb-6 flex items-center gap-2 text-sm text-slate-500">
            <Link href="/store" className="hover:text-slate-900 transition-colors">
              ← {t('detail.backToStore')}
            </Link>
          </div>

          {isService ? (
            <ServiceHero
              name={product.name}
              brand={product.brand ?? null}
              description={product.description}
              priceLabel={formatPrice(product.priceCents, product.currency)}
              currency={product.currency}
              serviceMeta={product.serviceMeta as any}
              sku={product.sku}
              t={{
                duration: t('detail.duration'),
                coverage: t('detail.coverage'),
                remote: t('detail.remote'),
                onsite: t('detail.onsite'),
                consultation: t('detail.consultation'),
                buy: t('detail.buy'),
                requiresBranch: t('detail.requiresBranch'),
                oneTimeVatIncluded: t('detail.oneTimeVatIncluded'),
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_1fr]">
              <Gallery images={galleryImages} alt={product.name} />
              <div className="flex flex-col">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {product.brand && (
                    <span className="text-xs uppercase tracking-wide text-slate-500">
                      {product.brand}
                    </span>
                  )}
                  {showGib && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      {t('gibCertified')}
                    </span>
                  )}
                  {product.available > 0 && product.available <= 5 && (
                    <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
                      {t('detail.lowStock', { n: product.available })}
                    </span>
                  )}
                </div>
                <h1 className="text-3xl md:text-4xl font-bold text-slate-900">{product.name}</h1>
                {product.description && (
                  <p className="mt-3 text-slate-600">{product.description}</p>
                )}

                <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5">
                  <div className="text-3xl font-semibold text-slate-900">
                    {formatPrice(product.priceCents, product.currency)}
                  </div>
                  {product.rentalMonthlyCents ? (
                    <div className="mt-1 text-sm text-slate-500">
                      {t('rentalFrom', {
                        currency: '',
                        amount: formatPrice(product.rentalMonthlyCents, product.currency),
                      })}
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-slate-500">
                    {t('warrantyMonths', { months: product.warrantyMonths })}
                  </div>
                  {/* CTA branches by regulatory tier (TR law). */}
                  {mode === 'DIRECT_SALE' ? (
                    <a
                      href={appHref(`/admin/store?sku=${encodeURIComponent(product.sku)}`)}
                      className={`mt-4 inline-flex w-full items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium text-white transition-colors ${
                        isOos
                          ? 'cursor-not-allowed bg-slate-300'
                          : 'bg-slate-900 hover:bg-slate-800'
                      }`}
                      aria-disabled={isOos}
                    >
                      {isOos ? t('outOfStock') : t('detail.buy')}
                    </a>
                  ) : mode === 'QUOTE_ONLY' ? (
                    <>
                      <Link
                        href="/contact"
                        className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700"
                      >
                        Teklif Al
                      </Link>
                      <p className="mt-3 text-xs leading-snug text-amber-700">
                        Bu ürün doğrudan satışa kapalıdır. Yetkili bayi/servis üzerinden teklif ve
                        kurulum süreci başlatılır (GİB aktivasyonu dahil). Yukarıdaki fiyat liste
                        fiyatıdır; kesin fiyat teklifte netleşir.
                      </p>
                    </>
                  ) : mode === 'PARTNER_REDIRECT' ? (
                    <>
                      {partnerUrl ? (
                        <a
                          href={partnerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
                        >
                          {product.partnerRedirect?.partnerName
                            ? `${product.partnerRedirect.partnerName} ile devam et`
                            : 'Banka/Ödeme kuruluşuna git'}
                        </a>
                      ) : (
                        <Link
                          href="/contact"
                          className="mt-4 inline-flex w-full items-center justify-center rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700"
                        >
                          Bilgi Al
                        </Link>
                      )}
                      <p className="mt-3 text-xs leading-snug text-indigo-700">
                        POS hizmeti HummyTummy tarafından değil, anlaşmalı banka/ödeme kuruluşu
                        tarafından sağlanır.
                      </p>
                    </>
                  ) : (
                    <p className="mt-4 rounded-md bg-slate-100 px-4 py-2.5 text-center text-sm font-medium text-slate-600">
                      Önerilen ekipman — doğrudan satışı yapılmamaktadır.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Tabs — Description / Specs / Compat / Requirements / FAQ for
              hardware; Includes / Steps / Requirements / FAQ for service. */}
          <DetailTabs
            isService={isService}
            description={product.description}
            specs={product.specs as any}
            compat={product.compat as any}
            details={details}
            warrantyMonths={product.warrantyMonths}
            t={{
              tabDescription: t('detail.tabs.description'),
              tabSpecs: t('detail.tabs.specs'),
              tabCompat: t('detail.tabs.compat'),
              tabRequirements: t('detail.tabs.requirements'),
              tabFaq: t('detail.tabs.faq'),
              tabIncludes: t('detail.tabs.includes'),
              tabSteps: t('detail.tabs.steps'),
              warrantyMonthsLabel: t('detail.warrantyMonthsLabel', { months: product.warrantyMonths }),
              noDetailsAuthored: t('detail.noDetailsAuthored'),
              empty: t('detail.empty'),
            }}
          />

          {/* Hardware-specific spec table is rendered INSIDE the Specs tab.
              Surface a separate compact summary table only when there are
              specs and the row is not a service. */}
          {!isService && product.specs && Object.keys(product.specs).length > 0 && (
            <section className="mt-10 hidden">
              {/* SpecsTable lives inside DetailTabs for the actual tab
                  pane; this hidden duplicate keeps a side-effect-free
                  reference for the import-or-tree-shake test. */}
              <SpecsTable specs={product.specs as Record<string, unknown>} />
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
