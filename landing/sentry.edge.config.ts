import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only initialize if DSN is provided
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

  // Performance Monitoring - sample 10% of transactions
  tracesSampleRate: 0.1,

  // Release tracking
  release: `restaurant-pos-landing@${process.env.NEXT_PUBLIC_APP_VERSION || 'dev'}`,
});
