import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { useUpdateTableStatus } from '../../features/tables/tablesApi';

interface ManualLockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  tableNumber: string;
  /** Fires after a successful PATCH /tables/:id/status=AVAILABLE.
   *  Parent uses this to navigate the waiter into the order screen so
   *  they can start taking the order immediately — the table will
   *  naturally flip to OCCUPIED once the first order lands. */
  onUnlocked: () => void;
}

/**
 * Shown when a waiter taps a RESERVED table that has no
 * `upcomingReservation` annotation — i.e. an admin manually flipped
 * the table to RESERVED with no booking row backing it.
 *
 * Counterpart to ReservationActionDialog: that one seats a booked
 * reservation, this one overrides an admin lock. The semantics
 * differ enough (no booking to "seat", different copy, different
 * permission story) that we keep two components rather than a single
 * variant-driven dialog.
 */
const ManualLockDialog = ({
  isOpen,
  onClose,
  tableId,
  tableNumber,
  onUnlocked,
}: ManualLockDialogProps) => {
  const { t } = useTranslation('pos');
  const updateStatus = useUpdateTableStatus();

  const handleProceed = () => {
    updateStatus.mutate(
      { id: tableId, status: 'AVAILABLE' },
      {
        onSuccess: () => {
          onUnlocked();
        },
      },
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (updateStatus.isPending) return;
        onClose();
      }}
      title={t('manualLockDialog.title')}
      size="md"
    >
      <div className="space-y-5">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">{t('manualLockDialog.banner', { tableNumber })}</p>
            <p className="text-amber-800/90">{t('manualLockDialog.body')}</p>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={updateStatus.isPending}>
            {t('manualLockDialog.cancelButton')}
          </Button>
          <Button variant="primary" onClick={handleProceed} isLoading={updateStatus.isPending}>
            {t('manualLockDialog.proceedButton')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ManualLockDialog;
