import { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';

export default function sitemap(): MetadataRoute.Sitemap {
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

  return entries;
}
