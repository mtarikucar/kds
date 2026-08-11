import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { useEntitlements } from '../../contexts/SubscriptionContext';
import { formatCents } from '../../features/licensing/licensingApi';

/**
 * The one global billing banner.
 *
 * It appears for exactly two states, both of which have a deadline: a renewal
 * coming up, and a licence that has lapsed and is taking paid modules down
 * with it. Anything else — an active licence, no licence at all — is not
 * urgent and belongs on the licence page, not above every screen.
 */
const RenewalBanner = () => {
  const { t } = useTranslation('licensing');
  const navigate = useNavigate();
  const { license, renewal, isLoading } = useEntitlements();

  if (isLoading) return null;

  if (license.status === 'expired') {
    return (
      <button
        onClick={() => navigate('/admin/license')}
        className="flex w-full items-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white"
      >
        <AlertTriangle size={16} />
        {t('license.status.expired')} — {t('license.renewCta')}
      </button>
    );
  }

  if (renewal) {
    return (
      <button
        onClick={() => navigate(`/admin/license/renewal/${renewal.cycleId}`)}
        className="flex w-full items-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white"
      >
        <CalendarClock size={16} />
        {t('renewal.body', {
          total: formatCents(renewal.totalCents, renewal.currency),
          days: renewal.daysLeft,
        })}
      </button>
    );
  }

  return null;
};

export default RenewalBanner;
