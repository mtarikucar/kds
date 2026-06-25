import React from 'react';
import { useTranslation } from 'react-i18next';
import { XCircle, Clock, CreditCard, AlertTriangle } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import type { TerminalChargeView } from '../../features/payment-terminal/paymentTerminalApi';

interface TerminalChargeModalProps {
  /** Non-null while a charge attempt is on screen; null hides the modal. */
  charge: { status: TerminalChargeView['status']; error: string | null } | null;
  /** Amount being charged, in major units, for display. */
  amount: number;
  /** Abort a still-pending charge (bridge terminals). */
  onCancel: () => void;
  /** Re-run the charge after a decline/timeout/error. */
  onRetry: () => void;
  /** Dismiss a finished (non-pending) attempt and fall back to manual. */
  onClose: () => void;
}

/** Statuses where the card is still being read — no dismiss, only Cancel. */
const IN_PROGRESS: TerminalChargeView['status'][] = ['PENDING', 'APPROVED'];

/**
 * Drives the card terminal from the POS. The money side is entirely the
 * backend's (charge BEFORE record); this modal only reflects status and
 * offers cancel / retry. It NEVER records a payment itself.
 */
const TerminalChargeModal: React.FC<TerminalChargeModalProps> = ({
  charge,
  amount,
  onCancel,
  onRetry,
  onClose,
}) => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();
  const inProgress = !!charge && IN_PROGRESS.includes(charge.status);

  const statusLabel = (status: TerminalChargeView['status']): string => {
    switch (status) {
      case 'DECLINED':
        return t('terminalCharge.declined');
      case 'TIMEOUT':
        return t('terminalCharge.timeout');
      case 'CANCELLED':
        return t('terminalCharge.cancelled');
      case 'RECORDED':
        return t('terminalCharge.recorded');
      case 'ERROR':
      default:
        return t('terminalCharge.error');
    }
  };

  const StatusIcon: React.FC<{ status: TerminalChargeView['status'] }> = ({ status }) => {
    if (status === 'TIMEOUT')
      return <Clock className="h-12 w-12 text-amber-500" aria-hidden="true" />;
    if (status === 'CANCELLED')
      return <AlertTriangle className="h-12 w-12 text-slate-400" aria-hidden="true" />;
    return <XCircle className="h-12 w-12 text-red-500" aria-hidden="true" />;
  };

  return (
    <Modal
      isOpen={charge !== null}
      // While the card is being read, a backdrop/Escape dismiss must NOT hide an
      // in-flight charge — the cashier has to explicitly Cancel. Once the attempt
      // has settled (declined/error/etc.) the modal dismisses normally.
      onClose={inProgress ? () => {} : onClose}
      title={t('terminalCharge.title')}
      size="sm"
    >
      {charge && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="text-2xl font-semibold text-slate-900">{formatPrice(amount)}</div>

          {inProgress ? (
            <>
              <Spinner size="lg" />
              <div className="flex items-center justify-center gap-2 text-slate-600">
                <CreditCard className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
                <span>
                  {charge.status === 'APPROVED'
                    ? t('terminalCharge.recording')
                    : t('terminalCharge.waiting')}
                </span>
              </div>
              <Button variant="secondary" onClick={onCancel} className="mt-2 w-full">
                {t('terminalCharge.cancel')}
              </Button>
            </>
          ) : (
            <>
              <StatusIcon status={charge.status} />
              <div className="font-medium text-slate-800">{statusLabel(charge.status)}</div>
              {charge.error && <div className="text-sm text-red-600">{charge.error}</div>}
              <div className="mt-2 flex w-full gap-2">
                <Button variant="secondary" onClick={onClose} className="flex-1">
                  {t('terminalCharge.close')}
                </Button>
                <Button variant="primary" onClick={onRetry} className="flex-1">
                  {t('terminalCharge.retry')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
};

export default TerminalChargeModal;
