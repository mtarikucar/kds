import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hummytummy.com',
      },
      {
        protocol: 'https',
        hostname: 'staging.hummytummy.com',
      },
    ],
  },

  async headers() {
    // Starter Content-Security-Policy. Next + next-intl + Sentry need
    // 'unsafe-inline'/'unsafe-eval' on script-src today (they ship inline
    // bootstrap scripts and use new Function() in dev). Tighten in steps:
    // 1. add a nonce-based middleware and drop 'unsafe-inline'.
    // 2. swap Sentry's CDN replay worker for self-hosted to drop the
    //    sentry.io entry from connect-src.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://hummytummy.com https://staging.hummytummy.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.sentry.io https://hummytummy.com https://staging.hummytummy.com",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
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
