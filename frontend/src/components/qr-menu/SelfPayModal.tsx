import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Minus, Plus, CreditCard, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  useSessionPayableItems,
  useCreatePayIntent,
  type CustomerPayableItem,
} from '../../features/qr-menu/customerPayApi';
import { formatCurrency } from '../../lib/utils';
import PhoneInput from '../ui/PhoneInput';

interface SelfPayModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  currency: string;
  primaryColor: string;
}

const SelfPayModal: React.FC<SelfPayModalProps> = ({
  isOpen,
  onClose,
  sessionId,
  currency,
  primaryColor,
}) => {
  const { t } = useTranslation('common');
  const { data: payable, isLoading } = useSessionPayableItems(
    isOpen ? sessionId : null,
    // Refresh every 5s while the modal is open — picks up waiter
    // edits and sibling-customer payments without a full reopen.
    { pollWhileOpen: isOpen },
  );
  const createIntent = useCreatePayIntent();

  const [selections, setSelections] = useState<Record<string, number>>({});
  const [customerPhone, setCustomerPhone] = useState('');
  // Synchronous double-tap guard (PayTR redirect navigates away — a
  // rapid second tap could fire two intents).
  const inflight = useRef(false);

  const orders = payable?.orders ?? [];
  const hasUnpaid = orders.some((o) => o.items.some((i) => i.remainingQuantity > 0));

  // Selected total computed client-side in integer kuruş, mirroring
  // the server's last-unit-residual rule so the displayed total never
  // drifts from what PayTR will charge.
  const selectedTotalKurus = useMemo(() => {
    if (!payable) return 0;
    let sum = 0;
    for (const order of orders) {
      for (const item of order.items) {
        const qty = selections[item.orderItemId] ?? 0;
        if (qty <= 0) continue;
        const perUnitKurus = Math.round(parseFloat(item.unitTotal) * 100);
        const closesLast = item.paidQuantity + qty === item.quantity;
        if (closesLast) {
          const itemTotalKurus = Math.round(parseFloat(item.itemTotal) * 100);
          const priorKurus = perUnitKurus * item.paidQuantity;
          sum += Math.max(0, itemTotalKurus - priorKurus);
        } else {
          sum += perUnitKurus * qty;
        }
      }
    }
    return sum;
  }, [orders, payable, selections]);

  const selectedTotal = selectedTotalKurus / 100;
  const totalSelectedUnits = useMemo(
    () => Object.values(selections).reduce((a, b) => a + b, 0),
    [selections],
  );

  const stepUp = (item: CustomerPayableItem) =>
    setSelections((prev) => {
      const current = prev[item.orderItemId] ?? 0;
      if (current >= item.remainingQuantity) return prev;
      return { ...prev, [item.orderItemId]: current + 1 };
    });
  const stepDown = (item: CustomerPayableItem) =>
    setSelections((prev) => {
      const current = prev[item.orderItemId] ?? 0;
      if (current <= 0) return prev;
      return { ...prev, [item.orderItemId]: current - 1 };
    });

  const selectAll = () => {
    if (!payable) return;
    const next: Record<string, number> = {};
    for (const order of orders) {
      for (const item of order.items) {
        if (item.remainingQuantity > 0) {
          next[item.orderItemId] = item.remainingQuantity;
        }
      }
    }
    setSelections(next);
  };

  const handlePay = async () => {
    if (!sessionId || totalSelectedUnits === 0) return;
    if (inflight.current) return;
    const items = Object.entries(selections)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (items.length === 0) return;

    inflight.current = true;
    try {
      const response = await createIntent.mutateAsync({
        sessionId,
        items,
        customerPhone: customerPhone.trim() || undefined,
      });
      // Hand off to PayTR's hosted iFrame. On return PayTR will land
      // the user on PAYTR_OK_URL_POS (?oid=…), which routes to
      // PaymentResultPage.
      window.location.href = response.paymentLink;
    } catch (err: any) {
      inflight.current = false;
      // Prefer the localized message for known error codes; fall back
      // to the server's English text only when the code is unknown.
      // Without this a Turkish customer was seeing raw English.
      const code = err?.response?.data?.code as string | undefined;
      const codeKey = code ? `payment.errors.${code}` : '';
      const localized = code
        ? t(codeKey, { defaultValue: '' })
        : '';
      const msg =
        localized ||
        err?.response?.data?.message ||
        t('payment.intentFailed', 'Could not start payment');
      toast.error(msg);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ type: 'spring', damping: 24 }}
          className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-slate-100">
            <div className="rounded-xl bg-indigo-100 p-2">
              <CreditCard className="h-5 w-5 text-indigo-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-slate-900">
                {t('payment.title', 'Pay Now')}
              </h2>
              <p className="text-xs text-slate-500">
                {t('payment.subtitle', 'Select what you want to pay for')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100"
            >
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {isLoading && (
              <div className="text-center py-8 text-slate-500 text-sm">
                {t('common.loading', 'Loading…')}
              </div>
            )}

            {payable && !hasUnpaid && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-5 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                <p className="text-emerald-700 font-medium">
                  {t('payment.noOpenItems', 'Nothing to pay on this table.')}
                </p>
              </div>
            )}

            {hasUnpaid && (
              <>
                {/* Summary strip */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs flex flex-wrap gap-x-4 gap-y-1">
                  <span className="text-slate-500">
                    {t('billSplit.total', 'Total')}:{' '}
                    <span className="font-bold text-slate-900">
                      {formatCurrency(parseFloat(payable!.summary.totalAmount), currency)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    {t('billSplit.paid', 'Paid')}:{' '}
                    <span className="font-bold text-emerald-600">
                      {formatCurrency(parseFloat(payable!.summary.paidAmount), currency)}
                    </span>
                  </span>
                  <span className="text-slate-500">
                    {t('payment.remaining', 'Remaining')}:{' '}
                    <span className="font-bold text-indigo-700">
                      {formatCurrency(parseFloat(payable!.summary.remainingAmount), currency)}
                    </span>
                  </span>
                </div>

                {/* Items per order */}
                {orders.map((order) => {
                  const unpaid = order.items.filter((i) => i.remainingQuantity > 0);
                  if (unpaid.length === 0) return null;
                  return (
                    <div key={order.orderId} className="space-y-2">
                      {orders.length > 1 && (
                        <div className="text-xs font-semibold text-slate-500">
                          {t('payment.tabOrder', 'Order')} #{order.orderNumber}
                        </div>
                      )}
                      {unpaid.map((item) => {
                        const selectedQty = selections[item.orderItemId] ?? 0;
                        return (
                          <div
                            key={item.orderItemId}
                            className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-slate-900 text-sm truncate">
                                {item.productName ?? '—'}
                              </div>
                              {item.modifierLabels.length > 0 && (
                                <div className="text-xs text-slate-500 truncate">
                                  {item.modifierLabels.join(', ')}
                                </div>
                              )}
                              <div className="text-xs text-slate-500 mt-0.5">
                                {t('payment.unitsRemaining', '{{paid}} / {{total}} paid', {
                                  paid: item.paidQuantity,
                                  total: item.quantity,
                                })}{' '}
                                · {formatCurrency(parseFloat(item.unitTotal), currency)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => stepDown(item)}
                                disabled={selectedQty === 0}
                                className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 disabled:opacity-30 flex items-center justify-center"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <div className="w-7 text-center font-semibold text-slate-900 text-sm">
                                {selectedQty}
                              </div>
                              <button
                                type="button"
                                onClick={() => stepUp(item)}
                                disabled={selectedQty >= item.remainingQuantity}
                                className="w-8 h-8 rounded-lg text-white disabled:opacity-30 flex items-center justify-center"
                                style={{ backgroundColor: primaryColor }}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                <button
                  type="button"
                  onClick={selectAll}
                  className="w-full text-sm text-indigo-600 font-medium py-2"
                >
                  {t('payment.payEverything', 'Pay everything remaining')}
                </button>

                {/* Phone (optional) */}
                <PhoneInput
                  value={customerPhone}
                  onChange={setCustomerPhone}
                  label={t('payment.phoneOptional', 'Phone (optional — for loyalty)')}
                  defaultCountry="TR"
                />
              </>
            )}
          </div>

          {/* Footer */}
          {hasUnpaid && (
            <div className="border-t border-slate-100 px-5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">
                  {t('payment.totalToPay', 'You will pay')}
                </span>
                <span className="text-xl font-bold text-indigo-700">
                  {formatCurrency(selectedTotal, currency)}
                </span>
              </div>
              <button
                onClick={handlePay}
                disabled={totalSelectedUnits === 0 || createIntent.isPending}
                className="w-full py-3 rounded-xl text-white font-bold disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ backgroundColor: primaryColor }}
              >
                {createIntent.isPending ? (
                  t('payment.redirectingToPayTR', 'Redirecting to PayTR…')
                ) : (
                  <>
                    <CreditCard className="h-5 w-5" />
                    {t('payment.payWithPaytr', 'Pay with PayTR')}
                  </>
                )}
              </button>
              <p className="text-[10px] text-slate-400 text-center flex items-center justify-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {t('payment.paytrNote', 'Secure hosted payment by PayTR. Your card details never touch this site.')}
              </p>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default SelfPayModal;
