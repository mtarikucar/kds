import type { Payment } from '../../types';
import type { ReceiptSnapshot } from '../../types/hardware';

/**
 * Tauri-gated receipt-print + cash-drawer side-effects fired after a
 * successful payment. Extracted verbatim from POSPage's handlePaymentConfirm
 * onSuccess so the (hardware-coupled, hard-to-cover-inline) gating can be
 * unit-tested with injected fakes — no real Tauri runtime needed.
 *
 * Behavior preserved exactly:
 *  - ALL printing is gated on isTauri(); web users see no prints/drawer pops.
 *  - Requires a configured default printer (printerId) AND, for the receipt,
 *    a backend-persisted payment.receiptSnapshot.
 *  - Print failure is toasted with a one-tap Reprint action (10s) whose own
 *    failure is toasted again; the persisted snapshot is reused so a reprint
 *    is byte-identical to the original.
 *  - The cash drawer pops only for CASH payments (and only with a printerId).
 *  - Print/drawer promises are fire-and-forget (.catch only) — payment is
 *    already recorded server-side regardless.
 */

/** Hardware surface this side-effect needs — matches HardwareService statics. */
export interface ReceiptHardware {
  printReceipt: (deviceId: string, receipt: ReceiptSnapshot) => Promise<unknown>;
  openCashDrawer: (deviceId: string) => Promise<unknown>;
}

/** Toast surface — matches sonner's `toast` shape used here. */
export interface ReceiptToast {
  error: (
    message: string,
    opts?: {
      action?: { label: string; onClick: () => void };
      duration?: number;
    },
  ) => void;
}

export interface RunReceiptSideEffectsDeps {
  /** Desktop runtime gate — HardwareService is a no-op on the web. */
  isTauri: () => boolean;
  /** Active default receipt printer id, or null when none configured. */
  getPrinterId: () => string | null;
  hardware: ReceiptHardware;
  toast: ReceiptToast;
  /** i18n translator (key, fallback) -> string. */
  t: (key: string, fallback: string) => string;
}

/**
 * Run the post-payment hardware side-effects for `payment` paid via
 * `method`. Returns nothing (fire-and-forget, like the original inline code).
 */
export function runReceiptSideEffects(
  payment: Pick<Payment, 'receiptSnapshot'>,
  method: string,
  deps: RunReceiptSideEffectsDeps,
): void {
  const { isTauri, getPrinterId, hardware, toast, t } = deps;

  if (!isTauri()) return;

  const printerId = getPrinterId();

  if (printerId && payment.receiptSnapshot) {
    const snapshot = payment.receiptSnapshot;
    hardware.printReceipt(printerId, snapshot).catch((err) => {
      console.error('Receipt print failed:', err);
      toast.error(
        t('pos.payment.receiptPrintFailed', 'Receipt print failed — payment recorded.'),
        {
          action: {
            label: t('pos.reprint.label', 'Reprint Receipt'),
            onClick: () => {
              hardware.printReceipt(printerId, snapshot).catch((e) => {
                console.error('Reprint failed:', e);
                toast.error(
                  t('pos.reprint.failed', 'Reprint failed — check printer connection'),
                );
              });
            },
          },
          duration: 10_000,
        },
      );
    });
  }

  // Pop the cash drawer for cash payments.
  if (printerId && method === 'CASH') {
    hardware.openCashDrawer(printerId).catch((err) => {
      console.error('Cash drawer open failed:', err);
    });
  }
}
