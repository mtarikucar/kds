import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Clock, Loader2 } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import {
  useAcceptDeliveryOrder,
  useRejectDeliveryOrder,
  useSetDeliveryPrepTime,
} from '../../features/delivery-platforms/deliveryOrderActionsApi';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';

/**
 * Accept / Reject(reason) / set-Prep-time controls for an incoming delivery-
 * platform order, wired to deliveryOrderActionsApi.ts. Shared by the admin
 * delivery-orders queue and the KDS delivery panel so the operator behaviour
 * is identical wherever the order surfaces.
 *
 * State machine mirrors the backend DeliveryModerationService:
 *   - PENDING_APPROVAL → show Accept (with quick prep-time chips) + Reject.
 *   - PENDING / PREPARING (already accepted) → show "set prep time".
 *   - terminal (CANCELLED / PAID / SERVED) → nothing to moderate.
 *
 * Reject opens a required-reason modal. All toasts/errors are honest and come
 * from the mutation hooks (real backend message via getApiErrorMessage).
 */

interface DeliveryOrderModerationPanelProps {
  order: Order;
  /** Dark high-contrast theme for the KDS kiosk board. */
  kiosk?: boolean;
  /** Compact layout (smaller buttons) for dense list rows. */
  compact?: boolean;
}

// Quick prep-time presets (minutes) offered when accepting.
const PREP_PRESETS = [10, 15, 20, 30, 45];

const DeliveryOrderModerationPanel = ({
  order,
  kiosk = false,
  compact = false,
}: DeliveryOrderModerationPanelProps) => {
  const { t } = useTranslation('deliveryOrders');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [selectedPrep, setSelectedPrep] = useState<number | undefined>(undefined);
  const [prepInput, setPrepInput] = useState('');

  const acceptMutation = useAcceptDeliveryOrder();
  const rejectMutation = useRejectDeliveryOrder();
  const prepMutation = useSetDeliveryPrepTime();

  const busy =
    acceptMutation.isPending || rejectMutation.isPending || prepMutation.isPending;

  const handleAccept = () => {
    acceptMutation.mutate({ orderId: order.id, prepTimeMinutes: selectedPrep });
  };

  const handleConfirmReject = () => {
    const clean = reason.trim();
    if (!clean) return;
    rejectMutation.mutate(
      { orderId: order.id, reason: clean },
      {
        onSuccess: () => {
          setRejectOpen(false);
          setReason('');
        },
      },
    );
  };

  const handleSetPrep = () => {
    const minutes = parseInt(prepInput, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    prepMutation.mutate(
      { orderId: order.id, minutes },
      { onSuccess: () => setPrepInput('') },
    );
  };

  const isPendingApproval = order.status === OrderStatus.PENDING_APPROVAL;
  const isAcceptedActive =
    order.status === OrderStatus.PENDING ||
    order.status === OrderStatus.PREPARING;

  // Nothing to moderate (terminal or non-delivery) — render nothing.
  if (!isPendingApproval && !isAcceptedActive) return null;

  const labelText = cn(
    'text-xs font-medium',
    kiosk ? 'text-neutral-400' : 'text-slate-500',
  );

  return (
    <div className="space-y-2">
      {isPendingApproval && (
        <div className="space-y-2">
          {/* Quick prep-time presets attached to Accept */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={labelText}>{t('moderation.prepTimeOptional')}</span>
            {PREP_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy}
                onClick={() => setSelectedPrep((cur) => (cur === m ? undefined : m))}
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50',
                  selectedPrep === m
                    ? 'bg-blue-600 text-white border-blue-600'
                    : kiosk
                      ? 'bg-neutral-800 text-neutral-200 border-neutral-700 hover:bg-neutral-700'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50',
                )}
              >
                {t('moderation.minutesShort', { minutes: m })}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="success"
              size={compact ? 'sm' : 'md'}
              className={cn('flex-1', compact ? '' : 'min-h-[48px]')}
              onClick={handleAccept}
              isLoading={acceptMutation.isPending}
              disabled={busy}
            >
              <Check className="h-4 w-4 mr-1.5" />
              {selectedPrep
                ? t('moderation.acceptWithPrep', { minutes: selectedPrep })
                : t('moderation.accept')}
            </Button>
            <Button
              variant="danger"
              size={compact ? 'sm' : 'md'}
              className={cn('flex-1', compact ? '' : 'min-h-[48px]')}
              onClick={() => setRejectOpen(true)}
              disabled={busy}
            >
              <X className="h-4 w-4 mr-1.5" />
              {t('moderation.reject')}
            </Button>
          </div>
        </div>
      )}

      {isAcceptedActive && (
        <div className="space-y-1.5">
          <span className={labelText}>{t('moderation.setPrepTime')}</span>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Clock
                className={cn(
                  'absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4',
                  kiosk ? 'text-neutral-500' : 'text-slate-400',
                )}
              />
              <input
                type="number"
                min={1}
                max={240}
                inputMode="numeric"
                value={prepInput}
                onChange={(e) => setPrepInput(e.target.value)}
                placeholder={t('moderation.minutesPlaceholder')}
                disabled={busy}
                className={cn(
                  'w-full pl-8 pr-2 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50',
                  kiosk
                    ? 'bg-neutral-800 border-neutral-700 text-neutral-100 placeholder:text-neutral-500'
                    : 'bg-white border-slate-200 text-slate-900',
                )}
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSetPrep}
              isLoading={prepMutation.isPending}
              disabled={busy || !prepInput.trim()}
            >
              {prepMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              )}
              {t('moderation.setPrepTimeButton')}
            </Button>
          </div>
        </div>
      )}

      {/* Reject reason modal — reason is REQUIRED by the backend. */}
      <Modal
        isOpen={rejectOpen}
        onClose={() => {
          if (!rejectMutation.isPending) {
            setRejectOpen(false);
            setReason('');
          }
        }}
        title={t('moderation.rejectModalTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {t('moderation.rejectModalDescription')}
          </p>
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('moderation.reasonPlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejectOpen(false);
                setReason('');
              }}
              disabled={rejectMutation.isPending}
            >
              {t('moderation.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmReject}
              isLoading={rejectMutation.isPending}
              disabled={!reason.trim()}
            >
              {t('moderation.confirmReject')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default DeliveryOrderModerationPanel;
