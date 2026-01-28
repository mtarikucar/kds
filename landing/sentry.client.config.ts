import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only initialize if DSN is provided
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

  // Performance Monitoring - sample 10% of transactions
  tracesSampleRate: 0.1,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Release tracking
  release: `restaurant-pos-landing@${process.env.NEXT_PUBLIC_APP_VERSION || 'dev'}`,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],

  // Filter out sensitive data
  beforeSend(event) {
    // Remove sensitive data from breadcrumbs
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
        if (breadcrumb.data) {
          const sanitized = { ...breadcrumb.data };
          ['password', 'token', 'apiKey', 'secret', 'authorization'].forEach((key) => {
            if (sanitized[key]) {
              sanitized[key] = '[REDACTED]';
            }
          });
          return { ...breadcrumb, data: sanitized };
        }
        return breadcrumb;
      });
    }

    return event;
  },

  // Ignore certain errors
  ignoreErrors: [
    // Browser extensions
    'top.GLOBALS',
    'originalCreateNotification',
    // Network errors
    'NetworkError',
    'Network request failed',
    'Failed to fetch',
    // Common Next.js hydration errors (usually harmless)
    'Hydration failed',
    'Text content does not match',
  ],
});
