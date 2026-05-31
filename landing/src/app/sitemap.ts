import { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';

// v2.8.98 — pull catalog SKUs at build/revalidate time so /store/[sku]
// pages land in the sitemap. The store/[sku] page already revalidates
// on a 5-minute window; the sitemap follows the same cadence so a
// freshly-published SKU appears in search-engine crawls within
// minutes rather than only after the next full deploy.
async function fetchStoreSkus(): Promise<string[]> {
  try {
    const base =
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '') ??
      process.env.BACKEND_URL?.replace(/\/+$/, '') ??
      '';
    if (!base) return [];
    const res = await fetch(`${base}/v1/catalog/products`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const products = (await res.json()) as Array<{ sku?: string }>;
    return products
      .map((p) => p.sku)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
  } catch {
    // Catalog unreachable — emit the static portion of the sitemap
    // anyway. A missing SKU index for one build is preferable to a
    // failed sitemap render.
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Prefer the env-provided base URL so a staging build doesn't publish
  // a sitemap pointing at the prod domain. Fallback keeps the local dev
  // build working without extra env wiring.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
    'https://hummytummy.com';

  // v2.8.97 — expanded coverage. Pre-fix the sitemap had only the
  // locale homepages, so /pricing, /store, /contact, /terms etc were
  // discoverable only by following links — search engines miss them
  // on first crawl. Each route gets per-locale alternate links
  // (hreflang), a priority tuned to its commercial importance
  // (homepage > store > pricing > contact > legal), and a
  // changeFrequency hint that lets crawlers schedule re-visits
  // sensibly.
  const routes: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/store', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.85, changeFrequency: 'monthly' },
    { path: '/contact', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'monthly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
  ];

  const entries: MetadataRoute.Sitemap = [];
  const now = new Date();
  for (const route of routes) {
    for (const locale of locales) {
      entries.push({
        url: `${baseUrl}/${locale}${route.path}`,
        lastModified: now,
        changeFrequency: route.changeFrequency,
        priority: route.priority,
        alternates: {
          languages: Object.fromEntries(
            locales.map((l) => [l, `${baseUrl}/${l}${route.path}`])
          ),
        },
      });
    }
  }

  // v2.8.98 — fan out the catalog SKUs across every locale. Each SKU
  // gets priority 0.6 (below the static commercial pages but well
  // above legal) and weekly changeFrequency so refreshed pricing /
  // stock metadata is re-crawled promptly.
  const skus = await fetchStoreSkus();
  for (const sku of skus) {
    for (const locale of locales) {
      entries.push({
        url: `${baseUrl}/${locale}/store/${encodeURIComponent(sku)}`,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: 0.6,
        alternates: {
          languages: Object.fromEntries(
            locales.map((l) => [l, `${baseUrl}/${l}/store/${encodeURIComponent(sku)}`])
          ),
        },
      });
    }
  }

  return entries;
}
