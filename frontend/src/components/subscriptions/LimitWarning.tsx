import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { PlanLimits } from '../../types';

interface LimitWarningProps {
  /** Which plan limit to evaluate against. */
  resource: keyof PlanLimits;
  /** Current count of the resource on the tenant (caller supplies it). */
  currentCount: number;
}

/**
 * Inline pre-flight warning rendered above CRUD forms (new user, new
 * product, new table, etc.). Surfaces the plan limit *before* the
 * backend throws `ForbiddenException` so the user understands why
 * the action is restricted and can upgrade in-flow.
 */
export default function LimitWarning({ resource, currentCount }: LimitWarningProps) {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const { checkLimit } = useSubscription();
  const status = checkLimit(resource, currentCount);
  if (status.limit === -1) return null; // unlimited
  if (status.remaining > Math.max(2, status.limit * 0.2)) return null; // healthy headroom

  // Translate `maxUsers` → `users` so the i18n key matches the shared
  // `subscriptions.usage.*` group used by UsageMeters.
  const labelKey: Record<string, string> = {
    maxUsers: 'users',
    maxTables: 'tables',
    maxProducts: 'products',
    maxCategories: 'categories',
    maxMonthlyOrders: 'monthlyOrders',
  };
  const label = t(`subscriptions.usage.${labelKey[resource as string] ?? resource}`);

  const isFull = !status.allowed;
  const tone = isFull
    ? 'bg-red-50 border-red-200 text-red-900'
    : 'bg-amber-50 border-amber-200 text-amber-900';
  const iconTone = isFull ? 'text-red-600' : 'text-amber-600';

  return (
    <div className={`flex items-start gap-3 p-3 mb-3 border rounded-lg ${tone}`}>
      <AlertTriangle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconTone}`} />
      <div className="flex-1 text-sm">
        <p className="font-medium">
          {isFull
            ? t('subscriptions.limitWarning.full', {
                resource: label,
                limit: status.limit,
              })
            : t('subscriptions.limitWarning.near', {
                resource: label,
                current: status.current,
                limit: status.limit,
                remaining: status.remaining,
              })}
        </p>
        <button
          onClick={() => navigate('/subscription/plans')}
          className="mt-1 underline font-medium hover:opacity-80"
        >
          {t('subscriptions.limitWarning.upgrade')}
        </button>
      </div>
    </div>
  );
}
