import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Printer } from 'lucide-react';
import { Button } from '../ui/Button';
import { HardwareService, isTauri } from '../../lib/tauri';
import { useUiStore } from '../../store/uiStore';
import type { Payment } from '../../types';

interface ReprintReceiptButtonProps {
  payment: Pick<Payment, 'id' | 'receiptSnapshot'>;
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
  const enabled = inTauri && hasSnapshot && hasPrinter && !isPrinting;

  const tooltip = !inTauri
    ? t('pos.reprint.desktopOnly', 'Reprint is only available on the desktop POS app')
    : !hasPrinter
      ? t('pos.reprint.noPrinter', 'No default receipt printer configured')
      : !hasSnapshot
        ? t('pos.reprint.noSnapshot', 'This payment has no stored receipt snapshot')
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
