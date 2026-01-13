import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match root
    '/',
    // Match locale prefixed paths
    '/(en|tr|ru|uz|ar)/:path*',
    // Exclude static files, api, _next, etc.
    '/((?!api|_next|_vercel|.*\\..*).*)',
  ],
};
