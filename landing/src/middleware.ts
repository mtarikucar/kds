import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Several React-SPA-only path families used to hit this landing app
  // when typed bare (without the /app prefix), get a locale prefix
  // from next-intl, and 404. Catch them here with a 308 redirect to
  // the real SPA location. Bookmark-friendly, method-preserving.
  //   - /marketing/* → manager panel
  //   - /legal/*     → KVKK / Mesafeli Satış / İade — opened from the
  //                    subscription checkout consent block in a new tab.
  const spaPrefixes = ['/marketing', '/legal'];
  if (spaPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    const url = req.nextUrl.clone();
    url.pathname = '/app' + pathname;
    return NextResponse.redirect(url, 308);
  }

  // SEO alias slugs → canonical pages. "karekod menü" is the Turkish
  // synonym people actually type/search for the QR menu; /cloud-kitchen is
  // the English name of /bulut-mutfak. Works with or without a locale
  // prefix so both typed URLs and stale external links land correctly.
  const seoAliases: Record<string, string> = {
    '/karekod-menu': '/qr-menu',
    '/cloud-kitchen': '/bulut-mutfak',
  };
  const localeMatch = pathname.match(/^\/(en|tr|ru|uz|ar)(\/.*)$/);
  const aliasPrefix = localeMatch ? `/${localeMatch[1]}` : '';
  const aliasPath = localeMatch ? localeMatch[2] : pathname;
  const aliasTarget = seoAliases[aliasPath];
  if (aliasTarget) {
    const url = req.nextUrl.clone();
    url.pathname = aliasPrefix + aliasTarget;
    return NextResponse.redirect(url, 308);
  }

  return intlMiddleware(req);
}

export const config = {
  matcher: [
    // Match root
    '/',
    // Match locale prefixed paths
    '/(en|tr|ru|uz|ar)/:path*',
    // Explicit SPA-redirect targets — already covered by the catch-all
    // below, but spelled out so the redirect's intent is visible
    // without reading the function body.
    '/marketing/:path*',
    '/legal/:path*',
    // Exclude static files, api, _next, etc.
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
