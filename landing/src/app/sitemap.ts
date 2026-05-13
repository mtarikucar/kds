import { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';

export default function sitemap(): MetadataRoute.Sitemap {
  // Prefer the env-provided base URL so a staging build doesn't publish
  // a sitemap pointing at the prod domain. Fallback keeps the local dev
  // build working without extra env wiring.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ||
    'https://hummytummy.com';

  const entries: MetadataRoute.Sitemap = [];

  // Add homepage for each locale
  for (const locale of locales) {
    entries.push({
      url: `${baseUrl}/${locale}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
      alternates: {
        languages: Object.fromEntries(
          locales.map((l) => [l, `${baseUrl}/${l}`])
        ),
      },
    });
  }

  return entries;
}
