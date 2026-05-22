import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

export default function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The marketing panel lives inside the React SPA at /app/marketing/*.
  // Bare /marketing/* links (old bookmarks, typed URLs, links shared
  // from before the /app prefix existed) used to hit this Next.js
  // landing app, get a locale prefix from the intl middleware, and
  // 404 at /en/marketing/*. Catch them here and 308 to the real SPA
  // location — bookmark-friendly, method-preserving.
  if (pathname === '/marketing' || pathname.startsWith('/marketing/')) {
    const url = req.nextUrl.clone();
    url.pathname = '/app' + pathname;
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
    // Explicit marketing redirect target — already covered by the
    // catch-all below, but spelled out so the redirect's intent is
    // visible to anyone reading just the matcher.
    '/marketing/:path*',
    // Exclude static files, api, _next, etc.
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
