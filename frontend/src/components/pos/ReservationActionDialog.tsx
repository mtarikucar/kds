import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, User, Users, CalendarCheck } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import {
  useSeatReservation,
  useNoShowReservation,
  useCancelReservation,
} from '../../features/reservations/reservationsApi';
import type { UpcomingReservationOnTable } from '../../types';

interface ReservationActionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reservation: UpcomingReservationOnTable;
  tableNumber: string;
  /** Fires after a successful PATCH /reservations/:id/seat. Parent
   *  uses this to flip its local selectedTable into OCCUPIED and
   *  navigate into the order screen so the waiter can immediately
   *  take the seated guest's order. */
  onSeated: () => void;
}

/**
 * Shown when a waiter taps a RESERVED table in the POS that the
 * reservation-scheduler has auto-held (table.upcomingReservation
 * populated). Surfaces the reservation details that the floor plan
 * couldn't fit on the card, and gives the waiter the one action they
 * almost always want from here: "the guest arrived — seat them".
 *
 * Manually-RESERVED tables (admin lock, upcomingReservation=null)
 * do NOT open this modal; POSPage falls back to a plain
 * "manually reserved" toast for that case.
 */
const ReservationActionDialog = ({
  isOpen,
  onClose,
  reservation,
  tableNumber,
  onSeated,
}: ReservationActionDialogProps) => {
  const { t } = useTranslation('pos');
  const seatMutation = useSeatReservation();
  const noShowMutation = useNoShowReservation();
  const cancelMutation = useCancelReservation();

  // No-Show and Cancel are destructive-ish (they release the hold and
  // finalize the row) so each sits behind an inline confirm sub-step —
  // the footer swaps to a prompt instead of a browser confirm().
  const [confirmAction, setConfirmAction] = useState<'noShow' | 'cancel' | null>(null);

  const isBusy =
    seatMutation.isPending || noShowMutation.isPending || cancelMutation.isPending;

  const handleSeat = () => {
    seatMutation.mutate(reservation.id, {
      onSuccess: () => {
        // Cache invalidation lives inside the hook; we just bubble the
        // "seated, now go to order screen" signal up to POSPage.
        onSeated();
      },
      // onError shows toast via the shared error handler in the hook.
    });
  };

  const handleNoShow = () => {
    noShowMutation.mutate(reservation.id, {
      // Hook invalidates ['tables']/['reservations'] and toasts; the
      // refetch drops the hold so we just close.
      onSuccess: () => onClose(),
    });
  };

  const handleCancel = () => {
    cancelMutation.mutate(reservation.id, {
      onSuccess: () => onClose(),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        // Refuse backdrop/Escape closes while any PATCH is in flight —
        // otherwise the dialog disappears, the mutation resolves into
        // an unmounted component, and the waiter is dropped on the
        // table grid with the table silently flipped underneath them.
        // Forcing them to wait keeps the flow coherent.
        if (isBusy) return;
        onClose();
      }}
      title={t('reservationDialog.title')}
      size="md"
    >
      <div className="space-y-5">
        {/* Banner — quickly conveys "this isn't blocked forever, you
            can act on it". Amber matches the floor-plan badge style
            so the visual language is consistent. */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t('reservationDialog.banner', { tableNumber })}
        </div>

        {/* Detail rows. Stack vertically on mobile, two columns on
            larger screens — the icons make scanning faster. */}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <Clock className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <dt className="text-xs text-slate-500">{t('reservationDialog.timeLabel')}</dt>
              <dd className="text-sm font-medium text-slate-900">
                {reservation.startTime} — {reservation.endTime}
              </dd>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <User className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <dt className="text-xs text-slate-500">{t('reservationDialog.customerLabel')}</dt>
              <dd className="text-sm font-medium text-slate-900 truncate">
                {reservation.customerName}
              </dd>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <Users className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <dt className="text-xs text-slate-500">{t('reservationDialog.guestsLabel')}</dt>
              <dd className="text-sm font-medium text-slate-900">
                {reservation.guestCount}
              </dd>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <CalendarCheck className="h-4 w-4 text-slate-500 shrink-0" />
            <div>
              <dt className="text-xs text-slate-500">{t('reservationDialog.statusLabel')}</dt>
              <dd className="text-sm font-medium text-slate-900">
                {t(`reservations:status.${reservation.status}`, {
                  defaultValue: reservation.status,
                })}
              </dd>
            </div>
          </div>
        </dl>

        {/* Actions. Primary "Seat" is the overwhelmingly common case;
            No-Show and Cancel are quieter outline buttons, each behind
            an inline confirm sub-step that replaces the footer. We
            deliberately don't add a "walk-in anyway" button — the
            backend's 30-min overlap guard would 400 it, and offering
            it here would be misleading. */}
        {confirmAction ? (
          <div
            className={`rounded-lg border px-4 py-3 ${
              confirmAction === 'cancel'
                ? 'border-red-200 bg-red-50'
                : 'border-amber-200 bg-amber-50'
            }`}
          >
            <p
              className={`text-sm ${
                confirmAction === 'cancel' ? 'text-red-900' : 'text-amber-900'
              }`}
            >
              {t(
                confirmAction === 'cancel'
                  ? 'reservationDialog.cancelConfirmPrompt'
                  : 'reservationDialog.noShowConfirmPrompt',
                { customerName: reservation.customerName },
              )}
            </p>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction(null)}
                disabled={isBusy}
              >
                {t('reservationDialog.backButton')}
              </Button>
              {confirmAction === 'cancel' ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleCancel}
                  isLoading={cancelMutation.isPending}
                  disabled={isBusy && !cancelMutation.isPending}
                >
                  {t('reservationDialog.confirmCancelButton')}
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleNoShow}
                  isLoading={noShowMutation.isPending}
                  disabled={isBusy && !noShowMutation.isPending}
                >
                  {t('reservationDialog.confirmNoShowButton')}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={isBusy}>
              {t('reservationDialog.closeButton')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmAction('noShow')}
              disabled={isBusy}
            >
              {t('reservationDialog.noShowButton')}
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfirmAction('cancel')}
              disabled={isBusy}
            >
              {t('reservationDialog.cancelReservationButton')}
            </Button>
            <Button
              variant="primary"
              onClick={handleSeat}
              isLoading={seatMutation.isPending}
              disabled={isBusy && !seatMutation.isPending}
            >
              {t('reservationDialog.seatButton')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ReservationActionDialog;
