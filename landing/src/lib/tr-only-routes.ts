import { defaultLocale, type Locale } from '@/i18n/config';

/**
 * Routes that exist in Turkish only.
 *
 * Two kinds of page live here: answers about Turkish tax regulation, which have
 * no audience in another language, and the module/sector copy ported out of the
 * SPA, where machine-translating ~23,000 words would ship thin content in four
 * languages and do net harm.
 *
 * Each page enforces this itself — generateStaticParams emits `tr` alone and the
 * other locales notFound(). This list exists so the language switcher knows it
 * too: it swaps the locale segment and keeps the path, which on one of these
 * pages would walk the visitor straight into a 404.
 *
 * Add a route here in the same change that makes it Turkish-only.
 */
const TR_ONLY_PREFIXES = [
  '/e-adisyon-zorunlu-mu',
  '/karekod-rehberi',
  '/restoran-yazilimi-fiyatlari',
  '/ozellikler',
  '/cozumler',
] as const;

/** `pathname` is locale-less, as returned by next-intl's usePathname(). */
export function isTurkishOnlyRoute(pathname: string): boolean {
  return TR_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Where the language switcher should land. Staying on a Turkish-only path in
 * another locale is a 404, so those fall back to that locale's homepage.
 */
export function switchTarget(pathname: string, target: Locale): string {
  if (target !== defaultLocale && isTurkishOnlyRoute(pathname)) return '/';
  return pathname;
}
