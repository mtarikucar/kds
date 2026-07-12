import type { ReactNode } from 'react';
import Spinner from './Spinner';
import { ErrorState } from './ErrorState';

/**
 * Minimal structural slice of a react-query result. Typed loosely on purpose
 * so both `useQuery` results and hand-rolled mocks in tests satisfy it.
 */
export interface QueryLike {
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => unknown;
}

interface QueryStateGateProps {
  /**
   * One query (or several — the gate waits for all; the first failure wins).
   * Wire the whole query object so error + refetch travel together.
   */
  query: QueryLike | QueryLike[];
  /** Custom loading node; defaults to a centered spinner. */
  loading?: ReactNode;
  /** Rendered instead of children when `isEmpty` is true after a clean load. */
  empty?: ReactNode;
  isEmpty?: boolean;
  children: ReactNode;
}

/**
 * Shared loading / error / empty gate for query-backed sections.
 *
 *   <QueryStateGate
 *     query={ordersQuery}
 *     isEmpty={orders.length === 0}
 *     empty={<EmptyState title={t('orders:none')} />}
 *   >
 *     <OrdersTable rows={orders} />
 *   </QueryStateGate>
 *
 * isLoading → spinner (or the `loading` node), isError → shared ErrorState
 * with a retry button wired to `refetch`, `isEmpty` → the `empty` node,
 * otherwise → children.
 */
export function QueryStateGate({
  query,
  loading,
  empty,
  isEmpty = false,
  children,
}: QueryStateGateProps) {
  const queries = Array.isArray(query) ? query : [query];

  if (queries.some((q) => q.isLoading)) {
    return loading !== undefined ? <>{loading}</> : <Spinner className="py-12" />;
  }

  const failed = queries.filter((q) => q.isError);
  if (failed.length > 0) {
    const retryable = failed.filter((q) => typeof q.refetch === 'function');
    return (
      <ErrorState
        error={failed[0].error}
        onRetry={
          retryable.length > 0
            ? () => retryable.forEach((q) => q.refetch?.())
            : undefined
        }
      />
    );
  }

  if (isEmpty && empty !== undefined) return <>{empty}</>;

  return <>{children}</>;
}

export default QueryStateGate;
