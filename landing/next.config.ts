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
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
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
