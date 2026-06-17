import { Clock, MoreVertical, X, Check } from 'lucide-react';
import { Order, OrderStatus } from '../../types';
import Button from '../ui/Button';
import { getOrderUrgency, getUrgencyStyles, cn } from '../../lib/utils';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  kioskCardShell,
  kioskTitleText,
  kioskItemNameText,
  kioskQtyText,
} from './kioskTheme';

interface OrderCardProps {
  order: Order;
  onUpdateStatus: (orderId: string, status: OrderStatus) => void;
  onCancelOrder?: (orderId: string) => void;
  isUpdating?: boolean;
  // When set, the action button receives data-tour=<value> so the onboarding
  // tour can spotlight it. Used on the first PENDING card.
  actionTourTag?: string;
  // Dark high-contrast theme for kiosk mode. Default false = today's look.
  kiosk?: boolean;
}

const OrderCard = ({ order, onUpdateStatus, onCancelOrder, isUpdating, actionTourTag, kiosk = false }: OrderCardProps) => {
  const [elapsedTime, setElapsedTime] = useState('');
  const [urgency, setUrgency] = useState(getOrderUrgency(order.createdAt));
  // Two-step cancel: the dropdown item arms confirmation, then an inline
  // "Emin misiniz?" row commits or aborts. Prevents one-tap mis-cancels on a
  // busy touch screen.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // deep-review FM5: track the active Undo toast so an unmounting card (e.g.
  // removed by a realtime invalidation) can dismiss it before its timer fires.
  // toast.dismiss does NOT call onAutoClose, so this safely aborts a deferred
  // commit from a card that is no longer on the board.
  const cancelToastIdRef = useRef<string | number | null>(null);
  const { t } = useTranslation('kitchen');

  // deep-review FM5: on unmount, dismiss any pending Undo toast so a removed
  // card cannot commit a phantom cancel after the fact.
  useEffect(() => {
    return () => {
      if (cancelToastIdRef.current !== null) {
        toast.dismiss(cancelToastIdRef.current);
      }
    };
  }, []);

  // Update elapsed time and urgency every second
  useEffect(() => {
    const updateTimeAndUrgency = () => {
      const now = Date.now();
      const created = new Date(order.createdAt).getTime();
      const diffMs = now - created;
      const diffMins = Math.floor(diffMs / 60000);
      const diffSecs = Math.floor((diffMs % 60000) / 1000);

      if (diffMins > 0) {
        setElapsedTime(`${diffMins}m ${diffSecs}s`);
      } else {
        setElapsedTime(`${diffSecs}s`);
      }

      setUrgency(getOrderUrgency(order.createdAt));
    };

    updateTimeAndUrgency();
    const interval = setInterval(updateTimeAndUrgency, 1000);

    return () => clearInterval(interval);
  }, [order.createdAt]);

  const urgencyStyles = getUrgencyStyles(urgency);

  const getNextStatus = (currentStatus: OrderStatus): OrderStatus | null => {
    switch (currentStatus) {
      case OrderStatus.PENDING:
        return OrderStatus.PREPARING;
      case OrderStatus.PREPARING:
        return OrderStatus.READY;
      case OrderStatus.READY:
        return OrderStatus.SERVED;
      default:
        return null;
    }
  };

  const getActionButtonConfig = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return {
          label: t('kitchen.actions.startPreparing'),
          variant: 'primary' as const,
          className: 'bg-blue-600 hover:bg-blue-700',
        };
      case OrderStatus.PREPARING:
        return {
          label: t('kitchen.actions.markReady'),
          variant: 'primary' as const,
          className: 'bg-emerald-600 hover:bg-emerald-700',
        };
      case OrderStatus.READY:
        return {
          label: t('kitchen.actions.markServed'),
          variant: 'outline' as const,
          className: '',
        };
      default:
        return null;
    }
  };

  const nextStatus = getNextStatus(order.status);
  const actionConfig = getActionButtonConfig(order.status);
  const isCritical = urgency === 'critical';

  // DEFER the cancel by a short window so a fat-finger cancel is recoverable.
  // CANCELLED is a terminal state server-side (the order-state-machine forbids
  // CANCELLED→PENDING and stock is already reversed on cancel), so there is no
  // safe "un-cancel" after the fact. Instead we DON'T send the cancel yet: the
  // order stays on the board while the Undo toast is up, and we only commit it
  // when the toast times out. Tapping "Geri al" (or dismissing the toast)
  // aborts — the cancel is never sent.
  const handleConfirmCancel = () => {
    if (!onCancelOrder) return;
    setConfirmingCancel(false);
    let aborted = false;
    const id = toast(
      t('kitchen.cancellingToast', '#{{n}} siparişi iptal ediliyor…', { n: order.orderNumber }),
      {
        duration: 5000,
        action: {
          label: t('kitchen.undo', 'Geri al'),
          onClick: () => {
            aborted = true;
          },
        },
        // Only a natural timeout commits the cancel; an Undo tap or manual
        // dismiss leaves `aborted`/no-autoclose so the order is untouched.
        onAutoClose: () => {
          cancelToastIdRef.current = null;
          if (!aborted) onCancelOrder(order.id);
        },
      }
    );
    // deep-review FM5: remember the active toast so unmount can dismiss it.
    cancelToastIdRef.current = id;
  };

  return (
    <div
      className={cn(
        kioskCardShell(kiosk),
        urgencyStyles.border,
        isCritical && 'animate-pulse'
      )}
    >
      {/* Header */}
      <div className="p-3 md:p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            {/* Order Number */}
            <span className={kioskTitleText(kiosk)}>
              #{order.orderNumber}
            </span>
            {/* Table Badge */}
            {order.table && (
              <span className="px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-full whitespace-nowrap">
                {t('kitchen.table')} {order.table.number}
              </span>
            )}
            {/* Delivery Platform Badge */}
            {order.source && (() => {
              const PLATFORM_DISPLAY: Record<string, { label: string; className: string }> = {
                GETIR: { label: 'Getir', className: 'bg-purple-100 text-purple-700' },
                YEMEKSEPETI: { label: 'Yemeksepeti', className: 'bg-pink-100 text-pink-700' },
                TRENDYOL: { label: 'Trendyol', className: 'bg-orange-100 text-orange-700' },
                MIGROS: { label: 'Migros', className: 'bg-green-100 text-green-700' },
              };
              const display = PLATFORM_DISPLAY[order.source] || { label: order.source, className: 'bg-slate-100 text-slate-700' };
              return (
                <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap', display.className)}>
                  {display.label}
                </span>
              );
            })()}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Time Badge */}
            <div
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold',
                urgencyStyles.badge
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>{elapsedTime}</span>
            </div>

            {/* Dropdown Menu for Cancel */}
            {order.status === OrderStatus.PENDING && onCancelOrder && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                    aria-label={t('kitchen.moreOptions')}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setConfirmingCancel(true)}
                    className="text-red-600 focus:text-red-600"
                  >
                    <X className="h-4 w-4 mr-2" />
                    {t('kitchen.cancelOrder')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Order Items */}
        <div className="space-y-1.5 mb-3">
          {(order.orderItems || order.items || []).map((item) => (
            <div key={item.id} className="flex items-start justify-between text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className={kioskItemNameText(kiosk)}>
                    {item.product?.name}
                  </span>
                </div>
                {/* Modifiers */}
                {item.modifiers && item.modifiers.length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {item.modifiers.map((mod: any) => (
                      <p key={mod.id} className="text-xs text-blue-600 pl-2">
                        + {mod.modifier?.name || mod.name}
                        {mod.quantity > 1 && ` x${mod.quantity}`}
                      </p>
                    ))}
                  </div>
                )}
                {/* Item Notes */}
                {item.notes && (
                  <p className="text-xs text-slate-500 italic mt-0.5 pl-2">
                    {item.notes}
                  </p>
                )}
              </div>
              <span className={kioskQtyText(kiosk)}>
                x{item.quantity}
              </span>
            </div>
          ))}
        </div>

        {/* Order Notes */}
        {order.notes && (
          <div className="mb-3 p-2 bg-amber-50 border border-amber-100 rounded-lg">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">{t('kitchen.orderNoteLabel')}:</span>{' '}
              {order.notes}
            </p>
          </div>
        )}

        {/* Inline cancel confirmation — armed from the dropdown. Big Yes/No
            targets so it's tap-safe on a kitchen screen. */}
        {confirmingCancel && onCancelOrder ? (
          <div
            className={cn(
              'mb-3 p-3 rounded-lg border',
              kiosk ? 'bg-red-950/40 border-red-800' : 'bg-red-50 border-red-200'
            )}
            role="group"
            aria-label={t('kitchen.cancelConfirm', 'Bu siparişi iptal etmek istediğinize emin misiniz?')}
          >
            <p className={cn('text-sm font-medium mb-2', kiosk ? 'text-red-200' : 'text-red-700')}>
              {t('kitchen.cancelConfirm', 'Bu siparişi iptal etmek istediğinize emin misiniz?')}
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                className="flex-1 min-h-[56px]"
                onClick={handleConfirmCancel}
                isLoading={isUpdating}
              >
                <Check className="h-4 w-4 mr-1.5" />
                {t('kitchen.confirmYes', 'Evet, iptal et')}
              </Button>
              <Button
                variant="outline"
                className="flex-1 min-h-[56px]"
                onClick={() => setConfirmingCancel(false)}
                disabled={isUpdating}
              >
                {t('kitchen.confirmNo', 'Hayır')}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Action Button — large primary touch target (>=56px tall) for
            fast, accurate taps on a kitchen tablet. */}
        {nextStatus && actionConfig && (
          <div data-tour={actionTourTag}>
            <Button
              variant={actionConfig.variant}
              className={cn('w-full min-h-[56px] text-base', actionConfig.className)}
              onClick={() => onUpdateStatus(order.id, nextStatus)}
              isLoading={isUpdating}
            >
              {actionConfig.label}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderCard;
