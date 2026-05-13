import * as Sentry from '@sentry/react';

// Substring match — case-insensitive — so we catch accessToken, refreshToken,
// authorization, x-api-key, set-cookie, refresh_token, etc. The previous
// allowlist was case-sensitive exact match against five keys, so a JWT in
// `accessToken` or `Set-Cookie` walked through untouched.
const SENSITIVE_FRAGMENTS = [
  'password',
  'token',          // catches accessToken, refreshToken, refresh_token, api-token
  'cookie',         // catches Cookie, Set-Cookie
  'authorization',
  'apikey',         // catches apiKey, api-key, x-api-key
  'secret',
  'session',        // catches sessionId, session_token
  'creditcard',     // catches creditCard, credit_card_number
];

function redactSensitive(input: unknown, depth = 0): unknown {
  // Hard depth cap so a circular structure doesn't recurse forever.
  if (depth > 6 || input == null) return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactSensitive(v, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const kLower = k.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE_FRAGMENTS.some((frag) => kLower.includes(frag))) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactSensitive(v, depth + 1);
      }
    }
    return out;
  }
  return input;
}

/**
 * Initialize Sentry error tracking and performance monitoring for React
 * This should be called at the very beginning of the application
 */
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  // Only initialize if DSN is provided
  if (!dsn) {
    console.log('⚠️  Sentry DSN not configured - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE || 'development',

    // Performance Monitoring
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Performance monitoring sample rate
    tracesSampleRate: parseFloat(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || '0.1'),

    // Session Replay
    replaysSessionSampleRate: parseFloat(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || '0.1'),
    replaysOnErrorSampleRate: parseFloat(import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE || '1.0'),

    // Release tracking
    release: `restaurant-pos-frontend@${import.meta.env.VITE_APP_VERSION || 'dev'}`,

    // Filter out sensitive data
    beforeSend(event, _hint) {
      event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) =>
        breadcrumb.data
          ? {
              ...breadcrumb,
              data: redactSensitive(breadcrumb.data) as typeof breadcrumb.data,
            }
          : breadcrumb,
      );

      // Also scrub the top-level event surface. Sentry captures request
      // bodies and response payloads onto event.request / event.extra, which
      // the old allowlist skipped entirely. Tokens in an Axios error config
      // bypassed redaction.
      if (event.request?.headers) {
        event.request.headers = redactSensitive(event.request.headers) as typeof event.request.headers;
      }
      if (event.request?.data) {
        event.request.data = redactSensitive(event.request.data);
      }
      if (event.extra) {
        event.extra = redactSensitive(event.extra) as typeof event.extra;
      }

      // Remove localStorage/sessionStorage data that might contain tokens
      if (event.contexts?.browser) {
        delete event.contexts.browser;
      }

      return event;
    },

    // Ignore certain errors
    ignoreErrors: [
      // Browser extensions
      'top.GLOBALS',
      'originalCreateNotification',
      'canvas.contentDocument',
      'MyApp_RemoveAllHighlights',
      'atomicFindClose',
      // Network errors
      'NetworkError',
      'Network request failed',
      'Failed to fetch',
      // Random plugins/extensions
      'window.webkit.messageHandlers',
    ],
  });

  console.log('✅ Sentry error tracking initialized');
}

/**
 * Capture an exception manually
 */
export function captureException(error: Error, context?: Record<string, any>) {
  Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a message manually
 */
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info') {
  Sentry.captureMessage(message, level);
}

/**
 * Set user context for error tracking
 */
export function setUser(user: { id: string; email?: string; username?: string; tenantId?: string }) {
  Sentry.setUser(user);
}

/**
 * Clear user context
 */
export function clearUser() {
  Sentry.setUser(null);
}

/**
 * Add custom context to errors
 */
export function setContext(name: string, context: Record<string, any>) {
  Sentry.setContext(name, context);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(message: string, data?: Record<string, any>) {
  Sentry.addBreadcrumb({
    message,
    data,
    level: 'info',
  });
}
