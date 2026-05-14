import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Printer } from 'lucide-react';
import { Button } from '../ui/Button';
import { HardwareService, isTauri } from '../../lib/tauri';
import { useUiStore } from '../../store/uiStore';
import type { Payment } from '../../types';

interface ReprintReceiptButtonProps {
  // `status` is needed to disable reprint on REFUNDED/FAILED rows —
  // the immutable snapshot has no "İADE" overlay so a naive reprint
  // would produce a fiş that misleads the customer and the audit trail.
  payment: Pick<Payment, 'id' | 'receiptSnapshot' | 'status'>;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Reprint a customer receipt from a persisted snapshot. Disabled (with
 * an explanatory tooltip) when:
 *   - not running inside Tauri (web-only users have no printer)
 *   - no default receipt printer configured in uiStore
 *   - the payment has no `receiptSnapshot` (legacy payments from
 *     before PR #216, or a payment whose snapshot build failed)
 *
 * Always works against the backend-persisted snapshot, never re-derives
 * receipt content from order data — that way a reprint matches the
 * original byte-for-byte even if the order was edited later.
 */
export function ReprintReceiptButton({
  payment,
  variant = 'outline',
  size = 'sm',
  className,
}: ReprintReceiptButtonProps) {
  const { t } = useTranslation(['pos', 'common']);
  const defaultPrinterId = useUiStore((s) => s.defaultReceiptPrinterId);
  const [isPrinting, setIsPrinting] = useState(false);

  const inTauri = isTauri();
  const hasSnapshot = !!payment.receiptSnapshot;
  const hasPrinter = !!defaultPrinterId;
  // Block reprint for REFUNDED / FAILED payments — the snapshot is
  // immutable JSON so a naive reprint produces a fiş that still
  // reads "PAID" without any cancel/refund overlay. That's audit
  // pollution: customer walks out with a paid-looking receipt for
  // a payment the restaurant has actually reversed.
  const isReprintable = payment.status === 'COMPLETED';
  const enabled =
    inTauri && hasSnapshot && hasPrinter && isReprintable && !isPrinting;

  const tooltip = !inTauri
    ? t('pos.reprint.desktopOnly', 'Reprint is only available on the desktop POS app')
    : !hasPrinter
      ? t('pos.reprint.noPrinter', 'No default receipt printer configured')
      : !hasSnapshot
        ? t('pos.reprint.noSnapshot', 'This payment has no stored receipt snapshot')
        : !isReprintable
          ? t(
              'pos.reprint.notReprintable',
              'Refunded / failed payments cannot be reprinted',
            )
          : undefined;

  const handleClick = async () => {
    if (!enabled || !defaultPrinterId || !payment.receiptSnapshot) return;
    setIsPrinting(true);
    try {
      await HardwareService.printReceipt(defaultPrinterId, payment.receiptSnapshot);
      toast.success(t('pos.reprint.success', 'Receipt sent to printer'));
    } catch (err) {
      console.error('Reprint failed:', err);
      toast.error(t('pos.reprint.failed', 'Reprint failed — check printer connection'));
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      disabled={!enabled}
      title={tooltip}
      className={className}
    >
      <Printer className="h-4 w-4 mr-1.5" />
      {isPrinting
        ? t('pos.reprint.printing', 'Printing...')
        : t('pos.reprint.label', 'Reprint Receipt')}
    </Button>
  );
}

export default ReprintReceiptButton;
