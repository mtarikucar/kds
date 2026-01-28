import * as Sentry from '@sentry/node';

/**
 * Context for creating a Sentry transaction
 */
export interface TransactionContext {
  /** Transaction name (e.g., 'payment.create', 'order.create') */
  name: string;
  /** Operation type (e.g., 'payment', 'order', 'db') */
  op: string;
  /** Additional tags to attach to the transaction */
  tags?: Record<string, string | number | boolean>;
  /** Additional data to attach to the transaction */
  data?: Record<string, unknown>;
}

/**
 * Executes a function within a Sentry transaction for performance monitoring.
 * Automatically captures errors and timing information.
 *
 * @example
 * ```typescript
 * const result = await withTransaction(
 *   {
 *     name: 'payment.create',
 *     op: 'payment',
 *     tags: { 'payment.method': 'credit_card', 'tenant.id': tenantId },
 *   },
 *   async () => {
 *     // Your payment logic here
 *     return createPayment();
 *   }
 * );
 * ```
 */
export async function withTransaction<T>(
  context: TransactionContext,
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.startSpan(
    {
      name: context.name,
      op: context.op,
      attributes: context.data as Record<string, string | number | boolean | undefined>,
    },
    async (span) => {
      // Set tags on the span
      if (context.tags) {
        for (const [key, value] of Object.entries(context.tags)) {
          span.setAttribute(key, value);
        }
      }

      try {
        const result = await fn();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'Unknown error' }); // ERROR
        Sentry.captureException(error, {
          tags: context.tags,
          extra: context.data,
        });
        throw error;
      }
    }
  );
}

/**
 * Creates a child span within the current transaction.
 * Use this for sub-operations within a transaction.
 *
 * @example
 * ```typescript
 * await withTransaction({ name: 'order.create', op: 'order' }, async () => {
 *   // Validate products
 *   await withSpan({ name: 'validate-products', op: 'validation' }, async () => {
 *     // validation logic
 *   });
 *
 *   // Create order in DB
 *   await withSpan({ name: 'db.insert', op: 'db' }, async () => {
 *     // database insert
 *   });
 * });
 * ```
 */
export async function withSpan<T>(
  context: Omit<TransactionContext, 'tags'> & { tags?: Record<string, string | number | boolean> },
  fn: () => Promise<T>
): Promise<T> {
  return Sentry.startSpan(
    {
      name: context.name,
      op: context.op,
      attributes: {
        ...context.data,
        ...context.tags,
      } as Record<string, string | number | boolean | undefined>,
    },
    async (span) => {
      try {
        const result = await fn();
        span.setStatus({ code: 1 }); // OK
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'Unknown error' }); // ERROR
        throw error;
      }
    }
  );
}

/**
 * Adds a breadcrumb to the current Sentry scope.
 * Breadcrumbs are trail of events that happened before an error.
 */
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = 'info'
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Sets user context for the current scope.
 * All errors will be associated with this user.
 */
export function setUserContext(user: {
  id: string;
  email?: string;
  tenantId?: string;
}): void {
  Sentry.setUser({
    id: user.id,
    email: user.email,
    tenant_id: user.tenantId,
  });
}

/**
 * Sets additional context for debugging.
 */
export function setContext(name: string, context: Record<string, unknown>): void {
  Sentry.setContext(name, context);
}
