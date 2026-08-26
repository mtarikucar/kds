import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'hummytummy.com' },
      { protocol: 'https', hostname: 'staging.hummytummy.com' },
      // Manufacturer / authorized-distributor CDNs referenced from the
      // hardware-store seed. Whitelisted up-front so that future seed
      // updates that include image URLs don't need a deploy-time config
      // change. Restricted to known POS-hardware vendors.
      { protocol: 'https', hostname: '**.hugin.com.tr' },
      { protocol: 'https', hostname: 'www.beko.com.tr' },
      { protocol: 'https', hostname: 'www.epson.com.tr' },
      { protocol: 'https', hostname: 'www.sunmi.com' },
      { protocol: 'https', hostname: 'shop.interpay.com.tr' },
      { protocol: 'https', hostname: 'www.penetek.com' },
      { protocol: 'https', hostname: 'sps.honeywell.com' },
      { protocol: 'https', hostname: 'www.zebra.com' },
      { protocol: 'https', hostname: 'images.samsung.com' },
      { protocol: 'https', hostname: 'productimages.hepsiburada.net' },
      { protocol: 'https', hostname: 'cdn.dsmcdn.com' },
      { protocol: 'https', hostname: 'img.akakce.com' },
    ],
  },

  async headers() {
    // Content-Security-Policy. Next + next-intl + Sentry need
    // 'unsafe-inline' on script-src today (they ship inline bootstrap
    // scripts). v2.8.97 — dropped 'unsafe-eval' in production: Next's
    // dev server uses new Function() for HMR but the production bundle
    // does not, so the relaxed form is dev-only now. Step toward
    // nonce-based migration:
    // 1. add nonce middleware + 'strict-dynamic' and drop 'unsafe-inline'.
    // 2. swap Sentry's CDN replay worker for self-hosted to drop the
    //    sentry.io entry from connect-src.
    const isProd = process.env.NODE_ENV === 'production';
    // The Jeeta web-chat widget is loaded from another origin, so it needs BOTH
    // an entry here and one in frame-src below — the loader is a script that
    // injects an iframe. Without them the embed fails in the quietest way
    // possible: the browser blocks the script, no launcher button ever appears,
    // and the only trace is a CSP violation in a console nobody has open.
    // Verified against production before adding: widget.js and /widget both
    // serve 200, so the headers were the whole obstacle.
    const JEETA = 'https://jeetagrowth.com';
    const scriptSrc = isProd
      ? `script-src 'self' 'unsafe-inline' ${JEETA}`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${JEETA}`;
    const csp = [
      "default-src 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://hummytummy.com https://staging.hummytummy.com https://*.hugin.com.tr https://www.beko.com.tr https://www.epson.com.tr https://www.sunmi.com https://shop.interpay.com.tr https://www.penetek.com https://sps.honeywell.com https://www.zebra.com https://images.samsung.com https://productimages.hepsiburada.net https://cdn.dsmcdn.com https://img.akakce.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.sentry.io https://hummytummy.com https://staging.hummytummy.com",
      // Only the widget's own origin — NOT a blanket allowance. frame-src was
      // absent entirely, so it fell through to default-src 'self' and the
      // iframe was blocked even when the script was not.
      `frame-src 'self' ${JEETA}`,
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      // v2.8.99.2 — `require-trusted-types-for 'script'` added in v2.8.97 P2d
      // is dropped. It blocked Next.js 16 / React 19 hydration scripts
      // (Next's internal RSC bootstrap doesn't declare a Trusted Types
      // policy), so SSR rendered fine but the page exploded on the
      // client and fell through to error.tsx with "Something went
      // wrong". A future migration would have to: (a) define a
      // trustedTypes.createPolicy('next-react#__internal__'), (b)
      // verify Sentry's instrumentation also opts into the policy,
      // (c) add a CSP report-only stage to catch any straggler before
      // re-introducing the directive enforced.
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ];
  },
};

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // Organization and project names from Sentry
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for source map uploads
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress all logs during build
  silent: !process.env.CI,

  // Upload source maps to Sentry
  widenClientFileUpload: true,

  // Hide source maps from generated client bundles
  hideSourceMaps: true,

  // Disable telemetry
  telemetry: false,

  // Disable the Sentry webpack plugin if no auth token is provided
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
};

// Wrap with both next-intl and Sentry
export default withSentryConfig(withNextIntl(nextConfig), sentryWebpackPluginOptions);
