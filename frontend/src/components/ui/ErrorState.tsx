import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { getApiErrorMessage } from '../../lib/api-error';
import { Button } from './Button';

interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The caught error (typically `query.error`). Its server-provided
   * message is shown when available, via the shared getApiErrorMessage
   * helper; otherwise the generic common:app.error fallback.
   */
  error?: unknown;
  /** Override the displayed message entirely (already translated). */
  message?: string;
  /** Wire to `query.refetch` to get a retry button. */
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Shared error-state for failed queries. Counterpart of EmptyState —
 * use it instead of rendering nothing (or a bare toast) when a list
 * fails to load:
 *
 *   if (query.isError) {
 *     return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
 *   }
 */
const ErrorState = React.forwardRef<HTMLDivElement, ErrorStateProps>(
  ({ className, error, message, onRetry, retryLabel, ...props }, ref) => {
    const { t } = useTranslation('common');
    const text =
      message ?? getApiErrorMessage(error, t('app.error', { defaultValue: 'An error occurred' }));

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(
          'flex flex-col items-center justify-center px-6 py-12 text-center',
          className,
        )}
        {...props}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
          <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden="true" />
        </div>
        <p className="mt-4 max-w-sm text-sm font-medium text-slate-900">{text}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            {retryLabel ?? t('app.retry', { defaultValue: 'Try again' })}
          </Button>
        )}
      </div>
    );
  },
);

ErrorState.displayName = 'ErrorState';

export { ErrorState };
export default ErrorState;
