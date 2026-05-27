import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import ProductImage from './ProductImage';

/**
 * Public hardware store. Pulls the catalogue from the backend at request time
 * (server-side) so the page is fully SEO-indexable. The API returns only
 * `published` rows, no auth required.
 *
 * The Next runtime caches the fetch for 5 minutes so a sudden traffic spike
 * doesn't hammer the backend. The cache headers on the API response control
 * downstream CDN behavior; the `revalidate` here is the server-side ISR knob.
 *
 * The "Buy" CTA bridges to the SPA at /app/admin/store?sku=<sku>. The SPA's
 * StorePage reads that query param, auto-adds the matching product to the
 * in-memory cart, and continues to checkout. If the visitor isn't logged in
 * yet, the SPA's auth guard redirects to /app/login first and bounces back
 * to the store with the query param preserved.
 */

export const revalidate = 300; // 5 minutes

interface HardwareProduct {
  id: string;
  sku: string;
  category: string;
  name: string;
  brand: string | null;
  model: string | null;
  description: string | null;
  priceCents: number;
  rentalMonthlyCents: number | null;
  currency: string;
  warrantyMonths: number;
  images: string[];
  stockStatus: string;
  // Free-form compatibility / metadata. We read two keys:
  //   - gibCertified: boolean — drives the GİB rosette on ÖKC products.
  //   - sourceUrl: string    — public manufacturer/reseller URL so customers
  //                            can verify the device exists.
  compat: Record<string, unknown> | null;
}

async function fetchProducts(): Promise<HardwareProduct[]> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.BACKEND_URL ?? 'https://hummytummy.com/api';
  try {
    const res = await fetch(`${apiBase}/v1/catalog/products`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    return (await res.json()) as HardwareProduct[];
  } catch {
    // If the backend is unreachable at build / request time we render an
    // empty store rather than crash. The CDN cached version stays warm.
    return [];
  }
}

// Categories rendered in this preferred order — ÖKC first because it's the
// legally required device and the typical entry point for a new resto;
// peripherals follow.
const CATEGORY_ORDER = [
  'yazarkasa',
  'pos_terminal',
  'printer',
  'kds_screen',
  'tablet',
  'scanner',
  'caller_id',
  'cash_drawer',
  'bridge',
  'scale',
  'accessory',
  'service',
];

function formatPrice(cents: number, currency: string): string {
  return (cents / 100).toLocaleString('tr-TR', {
    style: 'currency',
    currency: currency || 'TRY',
    maximumFractionDigits: 0,
  });
}

function gibCertified(p: HardwareProduct): boolean {
  return Boolean(p.compat && (p.compat as { gibCertified?: boolean }).gibCertified === true);
}

function sourceUrl(p: HardwareProduct): string | null {
  const url = p.compat && (p.compat as { sourceUrl?: string }).sourceUrl;
  return typeof url === 'string' ? url : null;
}

export default async function StorePage() {
  const t = await getTranslations('store');
  const products = await fetchProducts();

  // Group + sort by CATEGORY_ORDER. Unknown categories fall to the end.
  const byCategory = products.reduce<Record<string, HardwareProduct[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {});
  const orderedCategories = [
    ...CATEGORY_ORDER.filter((c) => byCategory[c]),
    ...Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="mb-8">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
              ← {t('backToHome')}
            </Link>
          </div>

          <div className="mb-10">
            <span className="inline-block rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
              {t('headerBadge')}
            </span>
            <h1 className="mt-3 text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              {t('title')}
            </h1>
            <p className="text-slate-500 max-w-2xl">{t('subtitle')}</p>
          </div>

          {/* Category quick-nav. Anchor links jump to the section headers
              below; sticky on desktop so the visitor doesn't have to scroll
              back up. Server-rendered, zero client JS. */}
          {orderedCategories.length > 0 && (
            <nav
              aria-label={t('title')}
              // Navbar.tsx is h-16 mobile / h-20 desktop; match both
              // breakpoints so the sticky pills land flush with the
              // header instead of sliding under it on lg+.
              className="sticky top-16 lg:top-20 z-20 -mx-4 mb-10 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-3"
            >
              <div className="flex flex-wrap gap-2">
                {orderedCategories.map((c) => (
                  <a
                    key={c}
                    href={`#cat-${c}`}
                    className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(t as any)(`categories.${c}`) || c.replace(/_/g, ' ')}
                  </a>
                ))}
              </div>
            </nav>
          )}

          {products.length === 0 ? (
            <div className="rounded-lg border border-dashed p-16 text-center text-slate-500">
              {t('loadError')}
            </div>
          ) : (
            orderedCategories.map((category) => {
              const items = byCategory[category];
              return (
                <section key={category} id={`cat-${category}`} className="mb-16 scroll-mt-32">
                  <h2 className="mb-6 text-2xl font-semibold text-slate-900">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(t as any)(`categories.${category}`) || category.replace(/_/g, ' ')}
                  </h2>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {items.map((p) => {
                      const isOos = p.stockStatus === 'out_of_stock' || p.stockStatus === 'discontinued';
                      const src = sourceUrl(p);
                      const showGibBadge = gibCertified(p);
                      const stockLabel =
                        p.stockStatus === 'out_of_stock'
                          ? t('outOfStock')
                          : p.stockStatus === 'discontinued'
                            ? t('discontinued')
                            : p.stockStatus === 'preorder'
                              ? t('preorder')
                              : null;
                      return (
                        <article
                          key={p.id}
                          className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-lg"
                        >
                          {p.images?.[0] && (
                            // Client component so a 404 on the photo file
                            // hides the slot cleanly instead of showing the
                            // browser's broken-image icon. Until every SKU
                            // has a real photo in landing/public/products/,
                            // some slots will fall back to the text-only
                            // card layout.
                            <ProductImage src={p.images[0]} alt={p.name} />
                          )}
                          <div className="flex flex-col grow p-5">
                            <div className="mb-2 flex items-center gap-2 flex-wrap">
                              <span className="text-xs uppercase tracking-wide text-slate-500">
                                {p.brand}
                              </span>
                              {showGibBadge && (
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                                  {t('gibCertified')}
                                </span>
                              )}
                              {stockLabel && (
                                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                  {stockLabel}
                                </span>
                              )}
                            </div>
                            <h3 className="mb-2 text-lg font-semibold text-slate-900">{p.name}</h3>
                            {p.description && (
                              <p className="mb-4 line-clamp-4 text-sm text-slate-600">{p.description}</p>
                            )}
                            <div className="mt-auto">
                              <div className="mb-1 text-xl font-medium text-slate-900">
                                {formatPrice(p.priceCents, p.currency)}
                              </div>
                              {p.rentalMonthlyCents ? (
                                <div className="mb-2 text-xs text-slate-500">
                                  {t('rentalFrom', {
                                    currency: '',
                                    amount: formatPrice(p.rentalMonthlyCents, p.currency),
                                  })}
                                </div>
                              ) : null}
                              <div className="mb-3 text-xs text-slate-500">
                                {t('warrantyMonths', { months: p.warrantyMonths })}
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                {/* The SPA picks up the sku query param on
                                    /admin/store and auto-adds to cart.
                                    Plain <a> here so the URL is rendered
                                    verbatim (next-intl Link would prefix
                                    the locale; we don't want that for /app). */}
                                <a
                                  href={`/app/admin/store?sku=${encodeURIComponent(p.sku)}`}
                                  className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium text-white transition-colors ${
                                    isOos
                                      ? 'cursor-not-allowed bg-slate-300'
                                      : 'bg-slate-900 hover:bg-slate-800'
                                  }`}
                                  aria-disabled={isOos}
                                  onClick={isOos ? (e) => e.preventDefault() : undefined}
                                >
                                  {t('buy')}
                                </a>
                                {src && (
                                  <a
                                    href={src}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-md border border-slate-200 px-3 py-2 text-xs text-slate-500 hover:bg-slate-50"
                                  >
                                    ↗
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}

          {/* BYO (bring-your-own) disclaimer. Important trust signal for
              SMBs that already have a printer / scanner — they don't have
              to re-buy hardware to use HummyTummy. */}
          <section className="mt-16 rounded-2xl border border-slate-200 bg-slate-50 p-8 md:p-10">
            <h2 className="text-2xl font-semibold text-slate-900">{t('byo.title')}</h2>
            <p className="mt-3 max-w-3xl text-slate-600">{t('byo.body')}</p>
            <Link
              href="/contact"
              className="mt-5 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {t('byo.cta')}
            </Link>
          </section>

          {/* GİB compliance footnote — required disclosure for ÖKC sales. */}
          <p className="mt-8 text-xs text-slate-500">{t('gibFootnote')}</p>
        </div>
      </main>
      <Footer />
    </>
  );
}
