// The POS web app lives at the apex domain (hummytummy.com in prod,
// staging.hummytummy.com in staging). The landing site is now served from the
// landing.* subdomain, so EVERY link from the landing into the app must be
// ABSOLUTE to cross the origin boundary — a bare "/login" would resolve against
// landing.hummytummy.com (where no such route exists) and 404.
//
// NEXT_PUBLIC_SITE_URL already points at the app origin per-environment (set in
// the landing build args / compose), so we reuse it and fall back to prod.
const APP_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://hummytummy.com'
).replace(/\/+$/, '');

/**
 * Build an absolute URL into the POS app from the landing site.
 * `appHref('/login')` → `https://hummytummy.com/login`.
 */
export const appHref = (path: string): string =>
  `${APP_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
