import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Lucide icon component; defaults to Inbox. */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Optional call-to-action ("Add your first product"). */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Shared empty-state for lists/tables whose query returned zero rows.
 * Callers pass already-translated strings (the component stays
 * i18n-agnostic, same convention as Card/Input).
 *
 *   {products.length === 0 && (
 *     <EmptyState
 *       icon={Package}
 *       title={t('menu:noProducts')}
 *       description={t('menu:noProductsHint')}
 *       actionLabel={t('menu:addProduct')}
 *       onAction={() => setShowCreate(true)}
 *     />
 *   )}
 */
const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(
  (
    { className, icon: Icon = Inbox, title, description, actionLabel, onAction, ...props },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col items-center justify-center px-6 py-12 text-center',
          className,
        )}
        {...props}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Icon className="h-6 w-6 text-slate-400" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-sm font-heading font-semibold text-slate-900">
          {title}
        </h3>
        {description && (
          <p className="mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>
        )}
        {actionLabel && onAction && (
          <Button variant="primary" size="sm" className="mt-4" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    );
  },
);

EmptyState.displayName = 'EmptyState';

export { EmptyState };
export default EmptyState;
