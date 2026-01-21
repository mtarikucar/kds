import { useState } from 'react';
import { AlertTriangle, Clock, ArrowDownCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button';
import { useCancelScheduledDowngrade, ScheduledDowngrade } from '../../features/subscriptions/subscriptionsApi';
import { cn } from '../../lib/utils';

interface ScheduledDowngradeAlertProps {
  scheduledDowngrade: ScheduledDowngrade;
  subscriptionId: string;
  onCancelled?: () => void;
}

const ScheduledDowngradeAlert = ({
  scheduledDowngrade,
  subscriptionId,
  onCancelled,
}: ScheduledDowngradeAlertProps) => {
  const { t } = useTranslation('subscriptions');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const cancelMutation = useCancelScheduledDowngrade();

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(subscriptionId);
      setShowCancelConfirm(false);
      onCancelled?.();
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const newPlanName = scheduledDowngrade.scheduledPlan?.displayName || t('unknownPlan');

  return (
    <div className={cn('rounded-lg border-2 p-4 mb-6 bg-orange-50 border-orange-200')}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Clock className="w-6 h-6 flex-shrink-0 mt-0.5 text-orange-600" />
          <div>
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              {t('scheduledDowngrade.title')}
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800">
                {t('scheduledDowngrade.scheduled')}
              </span>
            </h3>

            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="w-4 h-4 text-orange-600" />
                <span>
                  {t('scheduledDowngrade.downgradingTo')}: <strong>{newPlanName}</strong>
                </span>
              </div>

              <div>
                {t('scheduledDowngrade.scheduledFor')}: <strong>{formatDate(scheduledDowngrade.scheduledFor)}</strong>
              </div>

              <p className="text-slate-500 text-xs mt-2">
                {t('scheduledDowngrade.description')}
              </p>
            </div>
          </div>
        </div>

        {/* Close/Cancel button */}
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="text-slate-400 hover:text-slate-600 p-1"
          title={t('scheduledDowngrade.cancel')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setShowCancelConfirm(true)}
          size="sm"
        >
          {t('scheduledDowngrade.cancelDowngrade')}
        </Button>
      </div>

      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {t('scheduledDowngrade.cancelTitle')}
            </h3>
            <p className="text-slate-600 mb-4">
              {t('scheduledDowngrade.cancelConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelMutation.isPending}
              >
                {t('common:buttons.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={handleCancel}
                isLoading={cancelMutation.isPending}
              >
                {t('scheduledDowngrade.keepCurrentPlan')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduledDowngradeAlert;
