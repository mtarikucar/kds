import type { GetServerSideProps } from 'next';
import manifest from '../sitemap-routes.generated.json';

/**
 * Served at /sitemap.xml. Until this existed the host answered 404 there and
 * at /robots.txt, so this portal's pages were reachable only by following a
 * link — and nothing linked here at all: the landing footer pointed Help
 * Center, Documentation and API Reference at href="#". A corpus this size was
 * effectively invisible to every crawler and every answer engine.
 *
 * A runtime route rather than a file in public/: the deployed image currently
 * answers 404 for public assets, and a route that is part of the Next build
 * cannot be dropped by an image-layer problem.
 *
 * The base URL comes from the environment so a staging deploy does not publish
 * a sitemap full of production URLs.
 */
const BASE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://developer.hummytummy.com').replace(/\/+$/, '');

function xml(): string {
  const { locales, routes } = manifest;
  const now = new Date().toISOString();
  const urls = routes
    .flatMap((route) =>
      locales.map((locale) => {
        const loc = `${BASE}/${locale}${route}`;
        const alts = locales
          .map(
            (l) =>
              `    <xhtml:link rel="alternate" hreflang="${l}" href="${BASE}/${l}${route}"/>`,
          )
          .concat(
            `    <xhtml:link rel="alternate" hreflang="x-default" href="${BASE}/tr${route}"/>`,
          )
          .join('\n');
        // The Turkish page of each route ranks above its English sibling:
        // Türkiye is the primary market.
        const priority = locale === 'tr' ? (route === '' ? '0.8' : '0.6') : (route === '' ? '0.7' : '0.5');
        return [
          '  <url>',
          `    <loc>${loc}</loc>`,
          `    <lastmod>${now}</lastmod>`,
          '    <changefreq>weekly</changefreq>',
          `    <priority>${priority}</priority>`,
          alts,
          '  </url>',
        ].join('\n');
      }),
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  res.write(xml());
  res.end();
  return { props: {} };
};

export default function Sitemap() {
  return null;
}
