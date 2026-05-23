import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';

/**
 * Public hardware store. Pulls the catalogue from the backend at request time
 * (server-side) so the page is fully SEO-indexable. The API returns only
 * `published` rows, no auth required.
 *
 * The Next runtime caches the fetch for 5 minutes so a sudden traffic spike
 * doesn't hammer the backend. The cache headers on the API response control
 * downstream CDN behavior; the `revalidate` here is the server-side ISR knob.
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
  currency: string;
  warrantyMonths: number;
  images: string[];
  stockStatus: string;
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

export default async function StorePage() {
  const t = await getTranslations('store');
  const products = await fetchProducts();

  const byCategory = products.reduce<Record<string, HardwareProduct[]>>((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {});

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="mb-8">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">
              ← {t('backToHome', { default: 'Back to home' })}
            </Link>
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
            {t('title', { default: 'Hardware Store' })}
          </h1>
          <p className="text-slate-500 mb-12 max-w-2xl">
            {t('subtitle', { default: 'HummyTummy-certified hardware for your restaurant: kitchen displays, printers, yazarkasa, POS terminals, and the HummyBox local bridge.' })}
          </p>

          {products.length === 0 ? (
            <div className="rounded-lg border border-dashed p-16 text-center text-slate-500">
              {t('empty', { default: 'Catalogue temporarily unavailable. Please check back shortly.' })}
            </div>
          ) : (
            Object.entries(byCategory).map(([category, items]) => (
              <section key={category} className="mb-16">
                <h2 className="mb-6 text-2xl font-semibold text-slate-900 capitalize">
                  {category.replace(/_/g, ' ')}
                </h2>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {items.map((p) => (
                    <article
                      key={p.id}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-lg"
                    >
                      {p.images?.[0] && (
                        // Next/Image would be ideal but the API serves remote
                        // URLs and configuring `images.remotePatterns` for
                        // every brand domain is more friction than payoff at
                        // MVP. Plain <img> with lazy loading suffices.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.images[0]}
                          alt={p.name}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover"
                        />
                      )}
                      <div className="p-5">
                        <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">
                          {p.brand} · {p.category.replace(/_/g, ' ')}
                        </div>
                        <h3 className="mb-2 text-lg font-semibold text-slate-900">{p.name}</h3>
                        <p className="mb-4 line-clamp-3 text-sm text-slate-600">
                          {p.description}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xl font-medium text-slate-900">
                            {(p.priceCents / 100).toLocaleString('tr-TR', {
                              style: 'currency',
                              currency: p.currency ?? 'TRY',
                            })}
                          </span>
                          <Link
                            href="/contact"
                            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800"
                          >
                            {t('inquire', { default: 'Inquire' })}
                          </Link>
                        </div>
                        <div className="mt-2 text-xs text-slate-500">
                          {p.warrantyMonths} {t('warrantyMonths', { default: 'months warranty' })}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
