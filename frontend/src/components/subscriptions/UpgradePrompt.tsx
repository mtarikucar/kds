import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Lock, ArrowRight, RefreshCw } from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import { formatCents } from '../../features/licensing/licensingApi';
import Button from '../ui/Button';

interface PurchasePromptProps {
  /** Entitlement key the caller needs — bare or prefixed. */
  feature?: string;
  limitKey?: string;
  currentCount?: number;
  limit?: number;
  compact?: boolean;
}

/**
 * "You need X — here is what X costs you today."
 *
 * The price comes from the licensing snapshot, which is the same catalog read
 * checkout prices from, so the number shown here is the number charged. The
 * previous implementation mapped each feature to a plan tier through a
 * hardcoded table in this file and told the user to "upgrade to PRO" — a
 * second source of pricing truth that nothing kept in sync, and meaningless
 * once products are sold one at a time.
 *
 * The prorated figure is the honest one to lead with: a module bought in
 * month ten costs a tenth of the year, and quoting the full annual price would
 * overstate what the customer is about to pay by an order of magnitude.
 */
const UpgradePrompt = ({
  feature,
  limitKey,
  currentCount,
  limit,
  compact,
}: PurchasePromptProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation(['plan', 'common']);
  const { offerFor, license } = useEntitlements();

  const key = feature ?? limitKey ?? '';
  const offer = offerFor(key);
  const needsLicense = license.status === 'none' || license.status === 'expired';
  const isRenewal = license.status === 'expired';

  const goToStore = () =>
    navigate(
      offer
        ? `/admin/store?tab=catalog&focus=${encodeURIComponent(offer.code)}`
        : '/admin/store?tab=catalog',
    );

  const title = offer?.name ?? t('plan:upsell.defaultTitle');
  const priceLine = offer
    ? offer.proratedCents === offer.annualPriceCents
      ? `${formatCents(offer.annualPriceCents, offer.currency)} ${t('plan:upsell.perYear')}`
      : t('plan:upsell.proratedPrice', {
          prorated: formatCents(offer.proratedCents, offer.currency),
          annual: formatCents(offer.annualPriceCents, offer.currency),
        })
    : null;

  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-center dark:border-gray-700 dark:bg-gray-900 ${
        compact ? 'gap-2 p-4' : 'gap-3 p-8'
      }`}
      data-testid="purchase-prompt"
    >
      <div className="rounded-full bg-amber-100 p-3 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
        {isRenewal ? <RefreshCw size={compact ? 18 : 24} /> : <Lock size={compact ? 18 : 24} />}
      </div>

      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>

      {limitKey && limit !== undefined ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('plan:upsell.limitReached', { current: currentCount ?? 0, limit })}
        </p>
      ) : (
        <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
          {needsLicense
            ? t('plan:upsell.licenceRequired')
            : t('plan:upsell.defaultDescription')}
        </p>
      )}

      {priceLine && (
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {priceLine}
        </p>
      )}

      <Button onClick={goToStore} className="mt-1">
        {isRenewal ? t('plan:upsell.renewCta') : t('plan:upsell.buyCta')}
        <ArrowRight size={16} className="ml-1" />
      </Button>
    </div>
  );
};

export default UpgradePrompt;
