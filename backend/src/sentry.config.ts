import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

/**
 * Initialize Sentry error tracking and performance monitoring
 * This should be called at the very beginning of the application
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;

  // Only initialize if DSN is provided
  if (!dsn) {
    console.log('⚠️  Sentry DSN not configured - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',

    // Performance Monitoring
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),

    // Profiling
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
    integrations: [
      new ProfilingIntegration(),
    ],

    // Release tracking
    release: `restaurant-pos-backend@${process.env.npm_package_version || 'unknown'}`,

    // Filter out sensitive data
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }

      // Remove sensitive query params
      if (event.request?.query_string) {
        const sanitized = event.request.query_string
          .replace(/password=[^&]*/gi, 'password=[REDACTED]')
          .replace(/token=[^&]*/gi, 'token=[REDACTED]')
          .replace(/api_key=[^&]*/gi, 'api_key=[REDACTED]');
        event.request.query_string = sanitized;
      }

      return event;
    },
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
export function setUser(user: { id: string; email?: string; username?: string }) {
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
