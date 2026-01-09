import { useState } from 'react';
import { AlertTriangle, Clock, XCircle, ArrowUpCircle, ArrowDownCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import { PendingPlanChange, useCancelPendingPlanChange } from '../../features/subscriptions/subscriptionsApi';
import { cn } from '../../lib/utils';

interface PendingChangeAlertProps {
  pendingChange: PendingPlanChange;
  subscriptionId: string;
  onCancelled?: () => void;
}

const PendingChangeAlert = ({
  pendingChange,
  subscriptionId,
  onCancelled,
}: PendingChangeAlertProps) => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const cancelMutation = useCancelPendingPlanChange();

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(subscriptionId);
      setShowCancelConfirm(false);
      onCancelled?.();
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const handleCompletePayment = () => {
    // Navigate to payment page with pending change context
    navigate(`/subscription/payment?pendingChangeId=${pendingChange.id}`);
  };

  const getStatusInfo = () => {
    switch (pendingChange.paymentStatus) {
      case 'PENDING':
        return {
          icon: Clock,
          color: 'bg-yellow-50 border-yellow-200',
          iconColor: 'text-yellow-600',
          label: t('pendingChange.awaitingPayment'),
        };
      case 'FAILED':
        return {
          icon: XCircle,
          color: 'bg-red-50 border-red-200',
          iconColor: 'text-red-600',
          label: t('pendingChange.paymentFailed'),
        };
      case 'EXPIRED':
        return {
          icon: AlertTriangle,
          color: 'bg-gray-50 border-gray-200',
          iconColor: 'text-gray-600',
          label: t('pendingChange.paymentExpired'),
        };
      default:
        return {
          icon: Clock,
          color: 'bg-blue-50 border-blue-200',
          iconColor: 'text-blue-600',
          label: pendingChange.paymentStatus,
        };
    }
  };

  const status = getStatusInfo();
  const StatusIcon = status.icon;
  const ChangeIcon = pendingChange.isUpgrade ? ArrowUpCircle : ArrowDownCircle;
  const newPlanName = pendingChange.newPlan?.displayName || t('unknownPlan');

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(amount);
  };

  // Don't show if already applied or completed
  if (pendingChange.appliedAt || pendingChange.paymentStatus === 'COMPLETED') {
    return null;
  }

  // Don't show expired changes
  if (pendingChange.paymentStatus === 'EXPIRED') {
    return null;
  }

  return (
    <div className={cn('rounded-lg border-2 p-4 mb-6', status.color)}>
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <StatusIcon className={cn('w-6 h-6 flex-shrink-0 mt-0.5', status.iconColor)} />
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              {t('pendingChange.title')}
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                pendingChange.paymentStatus === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
              )}>
                {status.label}
              </span>
            </h3>

            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <div className="flex items-center gap-2">
                <ChangeIcon className={cn(
                  'w-4 h-4',
                  pendingChange.isUpgrade ? 'text-green-600' : 'text-orange-600'
                )} />
                <span>
                  {pendingChange.isUpgrade
                    ? t('pendingChange.upgradingTo')
                    : t('pendingChange.downgradingTo')
                  }: <strong>{newPlanName}</strong>
                </span>
              </div>

              {pendingChange.prorationAmount > 0 && (
                <div>
                  {t('pendingChange.amount')}: <strong>{formatCurrency(pendingChange.prorationAmount, pendingChange.currency)}</strong>
                </div>
              )}

              {pendingChange.scheduledFor && (
                <div>
                  {t('pendingChange.scheduledFor')}: <strong>{formatDate(pendingChange.scheduledFor)}</strong>
                </div>
              )}

              <div className="text-gray-500 text-xs">
                {t('pendingChange.createdAt')}: {formatDate(pendingChange.createdAt)}
              </div>

              {pendingChange.failureReason && (
                <div className="mt-2 text-red-600 text-sm">
                  {t('pendingChange.failureReason')}: {pendingChange.failureReason}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Close/Cancel button */}
        <button
          onClick={() => setShowCancelConfirm(true)}
          className="text-gray-400 hover:text-gray-600 p-1"
          title={t('pendingChange.cancel')}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {pendingChange.paymentStatus === 'PENDING' && pendingChange.prorationAmount > 0 && (
          <Button
            variant="primary"
            onClick={handleCompletePayment}
            size="sm"
          >
            {t('pendingChange.completePayment')}
          </Button>
        )}

        {pendingChange.paymentStatus === 'FAILED' && (
          <Button
            variant="primary"
            onClick={handleCompletePayment}
            size="sm"
          >
            {t('pendingChange.retry')}
          </Button>
        )}

        <Button
          variant="outline"
          onClick={() => setShowCancelConfirm(true)}
          size="sm"
        >
          {t('pendingChange.cancel')}
        </Button>
      </div>

      {/* Cancel Confirmation Dialog */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t('pendingChange.cancel')}
            </h3>
            <p className="text-gray-600 mb-4">
              {t('pendingChange.cancelConfirm')}
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
                variant="danger"
                onClick={handleCancel}
                isLoading={cancelMutation.isPending}
              >
                {t('pendingChange.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingChangeAlert;
