import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { differenceInCalendarDays } from 'date-fns';
import { useSubscription } from '../../contexts/SubscriptionContext';

/**
 * Sticky status banner shown above the main content. Two flavours:
 *   - TRIALING with trialEnd in the future → countdown + "Subscribe now"
 *   - PAST_DUE → grace-period warning with days-left + "Pay now"
 * Both render as the same component so the layout reserves one banner
 * row at most. Users can dismiss until next session via sessionStorage.
 */
export default function SubscriptionStatusBanner() {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const { subscription, plan, isSubscriptionActive, isInGracePeriod } = useSubscription();

  const banner = useMemo(() => {
    if (!subscription) return null;
    if (isSubscriptionActive && subscription.isTrialPeriod && subscription.trialEnd) {
      const daysLeft = differenceInCalendarDays(new Date(subscription.trialEnd), new Date());
      if (daysLeft < 0) return null;
      return {
        kind: 'trial' as const,
        daysLeft,
      };
    }
    // Manual-renewal pre-expiry warning. Tenant is still ACTIVE but
    // currentPeriodEnd is approaching — surface a yellow banner from
    // 7 days out, escalating to red at ≤ 1 day. Skip if already in
    // grace (handled below) or in a trial.
    if (
      isSubscriptionActive &&
      !subscription.isTrialPeriod &&
      subscription.currentPeriodEnd
    ) {
      const daysLeft = differenceInCalendarDays(
        new Date(subscription.currentPeriodEnd),
        new Date(),
      );
      if (daysLeft >= 0 && daysLeft <= 7) {
        return {
          kind: 'preExpiry' as const,
          daysLeft,
        };
      }
    }
    if (isInGracePeriod && subscription.currentPeriodEnd) {
      // Backend grace = 7 days after currentPeriodEnd (past-due-subscriptions cron).
      const graceEnd = new Date(subscription.currentPeriodEnd);
      graceEnd.setDate(graceEnd.getDate() + 7);
      const daysLeft = Math.max(0, differenceInCalendarDays(graceEnd, new Date()));
      return {
        kind: 'grace' as const,
        daysLeft,
      };
    }
    // EXPIRED: grace ran out, tenant must re-subscribe. Hard red banner.
    if (subscription.status === 'EXPIRED') {
      return { kind: 'expired' as const, daysLeft: 0 };
    }
    return null;
  }, [subscription, isSubscriptionActive, isInGracePeriod]);

  const sessionKey = banner ? `subStatusBanner:${banner.kind}:${banner.daysLeft}` : '';
  const dismissed =
    banner && typeof window !== 'undefined' && sessionStorage.getItem(sessionKey) === '1';

  if (!banner || dismissed || !subscription) return null;

  const isUrgent = banner.daysLeft <= 3;
  const planName = plan?.displayName ?? '';

  if (banner.kind === 'trial') {
    return (
      <div
        className={`flex items-center justify-between gap-4 px-4 md:px-6 py-2 text-sm ${
          isUrgent
            ? 'bg-amber-100 text-amber-900 border-b border-amber-300'
            : 'bg-indigo-50 text-indigo-900 border-b border-indigo-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Clock className={`w-4 h-4 flex-shrink-0 ${isUrgent ? 'text-amber-700' : 'text-indigo-600'}`} />
          <span className="truncate">
            {t('subscriptions.statusBanner.trialCountdown', {
              plan: planName,
              days: banner.daysLeft,
            })}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() =>
              navigate(`/subscription/checkout?planId=${subscription.planId}&billingCycle=${subscription.billingCycle}`)
            }
            className={`text-xs font-medium px-3 py-1 rounded ${
              isUrgent
                ? 'bg-amber-700 text-white hover:bg-amber-800'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {t('subscriptions.statusBanner.subscribeNow')}
          </button>
          <button
            onClick={() => sessionStorage.setItem(sessionKey, '1')}
            className="opacity-60 hover:opacity-100"
            aria-label={t('subscriptions.statusBanner.dismiss')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (banner.kind === 'preExpiry') {
    return (
      <div
        className={`flex items-center justify-between gap-4 px-4 md:px-6 py-2 text-sm ${
          isUrgent
            ? 'bg-amber-100 text-amber-900 border-b border-amber-300'
            : 'bg-amber-50 text-amber-900 border-b border-amber-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-4 h-4 flex-shrink-0 text-amber-700" />
          <span className="truncate">
            {t('subscriptions.statusBanner.preExpiry', {
              plan: planName,
              days: banner.daysLeft,
              defaultValue:
                banner.daysLeft === 0
                  ? `${planName} aboneliğiniz bugün sona eriyor — şimdi yenileyin`
                  : banner.daysLeft === 1
                    ? `${planName} aboneliğiniz YARIN sona eriyor — şimdi yenileyin`
                    : `${planName} aboneliğiniz ${banner.daysLeft} gün sonra sona erecek — şimdi yenileyin`,
            })}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() =>
              navigate(
                `/subscription/checkout?planId=${subscription.planId}&billingCycle=${subscription.billingCycle}`,
              )
            }
            className="text-xs font-medium px-3 py-1 rounded bg-amber-700 text-white hover:bg-amber-800"
          >
            {t('subscriptions.statusBanner.renewNow', 'Şimdi yenile')}
          </button>
          <button
            onClick={() => sessionStorage.setItem(sessionKey, '1')}
            className="opacity-60 hover:opacity-100"
            aria-label={t('subscriptions.statusBanner.dismiss')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  if (banner.kind === 'expired') {
    return (
      <div className="flex items-center justify-between gap-4 px-4 md:px-6 py-2 text-sm bg-red-100 text-red-900 border-b border-red-300">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-700" />
          <span className="truncate">
            {t(
              'subscriptions.statusBanner.expired',
              'Aboneliğiniz sona erdi. Hizmete devam etmek için yenileyin.',
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => navigate('/subscription/plans?renew=1')}
            className="text-xs font-medium px-3 py-1 rounded bg-red-700 text-white hover:bg-red-800"
          >
            {t('subscriptions.statusBanner.resubscribe', 'Yeniden abone ol')}
          </button>
        </div>
      </div>
    );
  }

  // grace
  return (
    <div className="flex items-center justify-between gap-4 px-4 md:px-6 py-2 text-sm bg-red-50 text-red-900 border-b border-red-200">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-600" />
        <span className="truncate">
          {t('subscriptions.statusBanner.gracePeriod', {
            days: banner.daysLeft,
          })}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => navigate('/subscription/plans')}
          className="text-xs font-medium px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
        >
          {t('subscriptions.statusBanner.payNow')}
        </button>
        <button
          onClick={() => sessionStorage.setItem(sessionKey, '1')}
          className="opacity-60 hover:opacity-100"
          aria-label={t('subscriptions.statusBanner.dismiss')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
