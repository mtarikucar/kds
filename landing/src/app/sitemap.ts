import { MetadataRoute } from 'next';
import { locales, defaultLocale } from '@/i18n/config';
import { API_BASES, apiUrl } from '@/lib/api';
import { MODULES, SECTORS } from '@/content/catalog';
import { MODULE_CONTENT } from '@/content/modules';
import { SECTOR_CONTENT } from '@/content/sectors';

// v2.8.98 — pull catalog SKUs at build/revalidate time so /store/[sku]
// pages land in the sitemap. The store/[sku] page already revalidates
// on a 5-minute window; the sitemap follows the same cadence so a
// freshly-published SKU appears in search-engine crawls within
// minutes rather than only after the next full deploy.
async function fetchStoreSkus(): Promise<string[]> {
  // Walk the same base list the rest of the app uses, INTERNAL_API_URL first.
  //
  // This function used to reach for NEXT_PUBLIC_API_URL on its own — the public
  // host — which from inside the container means leaving the box, crossing
  // Cloudflare and hairpinning back. lib/api.ts documents that path as one that
  // "can quietly fail while the very same URL works from a browser", and it
  // did: on 2026-08-27 production's sitemap carried 139 URLs, and after the
  // v3.16.1 deploy it carried 64 across three consecutive fetches, while
  // /api/v1/catalog/products answered 200 publicly and /tr/store/HW-TAB-001
  // rendered fine. 75 store URLs had silently dropped out, and the catch below
  // is what made it silent.
  //
  // Sharing the list rather than restating it is the point: the divergence
  // existed because there were two copies of "where is the API".
  try {
    let products: Array<{ sku?: string }> | null = null;
    for (const base of API_BASES) {
      try {
        const res = await fetch(apiUrl(base, '/v1/catalog/products'), {
          next: { revalidate: 300 },
        });
        if (!res.ok) continue;
        products = (await res.json()) as Array<{ sku?: string }>;
        break;
      } catch {
        // Try the next base — an unreachable one is not a reason to give up.
      }
    }
    if (!products) return [];
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
  // NOTE: there is intentionally no '/pricing' entry — no such page exists
  // (pricing is the '#pricing' section on the homepage), and a sitemap URL
  // that 404s erodes crawl trust. The v2.8.97 entry was removed for that
  // reason. /qr-menu sits just below the homepage because "qr menü /
  // karekod menü" is the highest-intent query family we target.
  const routes: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/qr-menu', priority: 0.95, changeFrequency: 'weekly' },
    { path: '/store', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/bulut-mutfak', priority: 0.85, changeFrequency: 'weekly' },
    { path: '/contact', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/terms', priority: 0.3, changeFrequency: 'monthly' },
    { path: '/privacy', priority: 0.3, changeFrequency: 'monthly' },
  ];

  // Turkish-only routes. These answer questions about Turkish regulation and
  // exist in Turkish alone; generateStaticParams on each page returns only
  // 'tr' and the other locales notFound(). Fanning them across five locales
  // would submit four 404s per route.
  const trOnlyRoutes: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
    { path: '/e-adisyon-zorunlu-mu', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/restoran-yazilimi-fiyatlari', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/karekod-rehberi', priority: 0.85, changeFrequency: 'monthly' },
    { path: '/ozellikler', priority: 0.85, changeFrequency: 'weekly' },
    { path: '/cozumler', priority: 0.85, changeFrequency: 'weekly' },
    // Deep-dive pages. Only slugs that actually render are submitted: a module
    // that is hidden, that has no copy, or that redirects to a richer page
    // would be a sitemap URL answering 404 or 308, which erodes crawl trust.
    ...MODULES.filter(
      (m) => !m.hidden && !m.redirectTo && MODULE_CONTENT[m.slug],
    ).map((m) => ({
      path: `/ozellikler/${m.slug}`,
      priority: 0.75,
      changeFrequency: 'monthly' as const,
    })),
    ...SECTORS.filter((s) => SECTOR_CONTENT[s.slug]).map((s) => ({
      path: `/cozumler/${s.slug}`,
      priority: 0.75,
      changeFrequency: 'monthly' as const,
    })),
  ];

  const entries: MetadataRoute.Sitemap = [];
  const now = new Date();

  // Per-URL hreflang includes x-default pointing at the Turkish page. This is
  // a Türkiye-first product and a crawler sends no Accept-Language, so the
  // unlocalised entry point has to resolve to the market the site is written
  // for. The same map is emitted in the HTML head by src/lib/seo.ts; the two
  // must agree or a crawler sees the sitemap and the page disagreeing.
  const languagesFor = (path: string) => ({
    ...Object.fromEntries(locales.map((l) => [l, `${baseUrl}/${l}${path}`])),
    'x-default': `${baseUrl}/${defaultLocale}${path}`,
  });

  for (const route of routes) {
    for (const locale of locales) {
      entries.push({
        url: `${baseUrl}/${locale}${route.path}`,
        lastModified: now,
        changeFrequency: route.changeFrequency,
        // The Turkish page of each route outranks its siblings: Türkiye is the
        // primary market, so /tr is the URL we want crawled first and served
        // as the canonical representative of the route.
        priority: locale === defaultLocale ? route.priority : Math.max(0.1, route.priority - 0.1),
        alternates: { languages: languagesFor(route.path) },
      });
    }
  }

  for (const route of trOnlyRoutes) {
    entries.push({
      url: `${baseUrl}/${defaultLocale}${route.path}`,
      lastModified: now,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      // No `alternates`: there is one language, and declaring hreflang for a
      // single locale tells a crawler nothing it cannot see from the URL.
    });
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
        alternates: { languages: languagesFor(`/store/${encodeURIComponent(sku)}`) },
      });
    }
  }

  return entries;
}
