import type { Metadata } from 'next';
import { locales, localeConfig, defaultLocale, type Locale } from '@/i18n/config';

/**
 * The origin this build publishes under. A staging or preview build must not
 * emit canonical/og:url tags pointing at production, so the env value wins and
 * the literal is only a local-dev convenience.
 */
export function siteBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') || 'https://hummytummy.com'
  );
}

/**
 * Every page carries the same card image. It is a real file in public/ rather
 * than a generated one: /og-image.jpg answered HTTP 500 on every page in every
 * locale, so every preview card — social, chat, and whatever an answer engine
 * renders alongside a citation — was broken.
 */
const OG_IMAGE = {
  url: '/og-image.jpg',
  width: 1200,
  height: 630,
  alt: 'HummyTummy — Restoran POS ve Adisyon Programı',
} as const;

export type PageMeta = {
  title: string;
  description: string;
  keywords?: string;
};

type BuildArgs = {
  locale: string;
  /** Route path below the locale segment, '' for the locale homepage. */
  path: string;
  meta: PageMeta;
  /**
   * Locales this route actually exists in. Defaults to all of them. Routes
   * that ship in Turkish only pass ['tr'] so hreflang advertises exactly what
   * is published rather than pointing four languages at Turkish prose.
   */
  localeScope?: readonly Locale[];
};

/**
 * Page metadata with a self-referencing canonical.
 *
 * This helper exists because of two bugs that were live together, both of
 * which came from letting the layout supply metadata that pages inherit.
 *
 * 1. `alternates` was declared once on [locale]/layout.tsx. Next merges
 *    metadata by shallow override, so every page that did not declare its own
 *    `alternates` inherited `canonical: /${locale}` — the locale homepage.
 *    95 of the 110 URLs in the sitemap told search engines to index the
 *    homepage instead of themselves, the entire hardware store included.
 *
 * 2. `openGraph` is not deep-merged either. The two pages that DID override
 *    `alternates` also overrode `openGraph` with just a title and description,
 *    which silently dropped og:image, og:url, og:type and og:siteName and left
 *    their Twitter cards stamped with the homepage's text.
 *
 * Both classes of bug disappear if no page hand-rolls this object. Pages pass
 * their route and their copy; everything else is derived here.
 */
export function buildPageMetadata({
  locale,
  path,
  meta,
  localeScope = locales,
}: BuildArgs): Metadata {
  const baseUrl = siteBaseUrl();
  const canonicalPath = `/${locale}${path}`;
  const url = `${baseUrl}${canonicalPath}`;

  const languages: Record<string, string> = Object.fromEntries(
    localeScope.map((l) => [localeConfig[l].hreflang, `/${l}${path}`])
  );
  // x-default points at the Turkish page: this is a Türkiye-first product and
  // a crawler sends no Accept-Language, so the unlocalised entry point has to
  // resolve to the market the site is written for.
  languages['x-default'] = `/${localeScope.includes(defaultLocale) ? defaultLocale : localeScope[0]}${path}`;

  return {
    title: meta.title,
    description: meta.description,
    ...(meta.keywords ? { keywords: meta.keywords } : {}),
    alternates: { canonical: canonicalPath, languages },
    openGraph: {
      type: 'website',
      locale: localeConfig[locale as Locale]?.hreflang ?? defaultLocale,
      url,
      siteName: 'HummyTummy',
      title: meta.title,
      description: meta.description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      images: [OG_IMAGE.url],
    },
  };
}
