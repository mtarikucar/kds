import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  CreditCard,
  Smartphone,
  Minus,
  Plus,
  Users,
  CheckCircle2,
} from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { usePayableItems, usePayByItems } from '../../features/orders/ordersApi';
import type { PayableItem } from '../../types';

interface ProgressiveSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The orders to split across. When the parent passes more than one
   * (merged-table group), the modal renders a per-order tab strip and
   * the customer picks one tab at a time. Each submit fires per-order.
   */
  orders: Array<{ id: string; orderNumber: string; tableNumber?: string }>;
}

const METHODS = [
  { value: 'CASH' as const, icon: Banknote },
  { value: 'CARD' as const, icon: CreditCard },
  { value: 'DIGITAL' as const, icon: Smartphone },
];

type PaymentMethod = 'CASH' | 'CARD' | 'DIGITAL';

const ProgressiveSplitModal = ({
  isOpen,
  onClose,
  orders,
}: ProgressiveSplitModalProps) => {
  const { t } = useTranslation('pos');
  const formatCurrency = useFormatCurrency();
  const payByItems = usePayByItems();

  // Filter out any non-ids — defensive against parent passes.
  const validOrders = orders.filter((o) => !!o.id);

  const [activeOrderId, setActiveOrderId] = useState<string | null>(
    validOrders[0]?.id ?? null,
  );
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [customerLabel, setCustomerLabel] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [transactionId, setTransactionId] = useState('');

  // Reset state whenever the modal opens or the active order changes.
  useEffect(() => {
    if (isOpen) {
      const next = validOrders[0]?.id ?? null;
      setActiveOrderId(next);
    } else {
      setSelections({});
      setCustomerLabel('');
      setMethod('CASH');
      setTransactionId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    setSelections({});
  }, [activeOrderId]);

  const { data: payable, isLoading } = usePayableItems(
    isOpen ? activeOrderId : null,
  );

  // Anchor the selected-total math in integer kuruş so we don't drift
  // by floats. The unitTotal strings from the backend already include
  // any pro-rata discount.
  const selectedTotalKurus = useMemo(() => {
    if (!payable) return 0;
    let sum = 0;
    for (const item of payable.items) {
      const qty = selections[item.orderItemId] ?? 0;
      if (qty <= 0) continue;
      const perUnitKurus = Math.round(parseFloat(item.unitTotal) * 100);
      sum += perUnitKurus * qty;
    }
    return sum;
  }, [payable, selections]);

  const selectedTotal = selectedTotalKurus / 100;
  const totalSelectedUnits = useMemo(
    () => Object.values(selections).reduce((a, b) => a + b, 0),
    [selections],
  );

  const unpaidItems: PayableItem[] = payable
    ? payable.items.filter((i) => i.remainingQuantity > 0)
    : [];
  const paidItems: PayableItem[] = payable
    ? payable.items.filter((i) => i.paidQuantity > 0)
    : [];

  const stepUp = (item: PayableItem) => {
    setSelections((prev) => {
      const current = prev[item.orderItemId] ?? 0;
      if (current >= item.remainingQuantity) return prev;
      return { ...prev, [item.orderItemId]: current + 1 };
    });
  };
  const stepDown = (item: PayableItem) => {
    setSelections((prev) => {
      const current = prev[item.orderItemId] ?? 0;
      if (current <= 0) return prev;
      return { ...prev, [item.orderItemId]: current - 1 };
    });
  };
  const selectAll = () => {
    if (!payable) return;
    setSelections(
      Object.fromEntries(
        unpaidItems.map((i) => [i.orderItemId, i.remainingQuantity]),
      ),
    );
  };

  const submit = async (closeAfter: boolean) => {
    if (!activeOrderId || totalSelectedUnits === 0) return;
    const items = Object.entries(selections)
      .filter(([, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));
    if (items.length === 0) return;

    try {
      await payByItems.mutateAsync({
        orderId: activeOrderId,
        items,
        method,
        notes: customerLabel || undefined,
        transactionId:
          method !== 'CASH' && transactionId ? transactionId : undefined,
      });
      // Clear per-customer fields after a successful charge.
      setSelections({});
      setCustomerLabel('');
      setTransactionId('');
      if (closeAfter) {
        onClose();
      }
    } catch {
      // Toast handled inside the mutation onError.
    }
  };

  const remainingQuantity = payable?.remainingQuantity ?? 0;
  const allPaid = !!payable && remainingQuantity === 0;
  const submitDisabled =
    !activeOrderId ||
    totalSelectedUnits === 0 ||
    payByItems.isPending ||
    allPaid;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-indigo-100 p-2 text-indigo-600">
            <Users className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-slate-900">
              {t('progressive.title')}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">
              {t('progressive.subtitle')}
            </p>
          </div>
        </div>

        {/* Tab strip for merged-table groups */}
        {validOrders.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {validOrders.map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveOrderId(o.id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeOrderId === o.id
                    ? 'bg-indigo-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
                type="button"
              >
                {t('progressive.tabOrder', { number: o.orderNumber })}
                {o.tableNumber ? ` · ${o.tableNumber}` : ''}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        )}

        {/* Body */}
        {payable && !isLoading && (
          <>
            {/* Summary strip */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
              <span className="text-slate-500">
                {t('billSplit.total')}:{' '}
                <span className="font-bold text-slate-900">
                  {formatCurrency(parseFloat(payable.finalAmount))}
                </span>
              </span>
              <span className="text-slate-500">
                {t('billSplit.paid')}:{' '}
                <span className="font-bold text-emerald-600">
                  {formatCurrency(parseFloat(payable.paidAmount))}
                </span>
              </span>
              <span className="text-slate-500">
                {t('progressive.remainingAmount')}:{' '}
                <span className="font-bold text-indigo-700">
                  {formatCurrency(parseFloat(payable.remainingAmount))}
                </span>
              </span>
            </div>

            {/* Fully paid */}
            {allPaid && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-6 text-center text-emerald-700 font-medium">
                <CheckCircle2 className="h-6 w-6 mx-auto mb-2" />
                {t('progressive.fullyPaid')}
              </div>
            )}

            {/* Unpaid items list */}
            {!allPaid && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {t('progressive.unpaidItems')}
                  </h3>
                  {unpaidItems.length > 0 && (
                    <button
                      type="button"
                      onClick={selectAll}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                    >
                      {t('billSplit.collectAll')}
                    </button>
                  )}
                </div>
                {unpaidItems.length === 0 && (
                  <div className="text-sm text-slate-500 italic">
                    {t('progressive.noUnpaidItems')}
                  </div>
                )}
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {unpaidItems.map((item) => {
                    const selectedQty = selections[item.orderItemId] ?? 0;
                    const unitTotal = parseFloat(item.unitTotal);
                    return (
                      <div
                        key={item.orderItemId}
                        className="flex items-center gap-3 bg-white rounded-lg border border-slate-200 px-3 py-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-slate-900 truncate">
                            {item.productName ?? '—'}
                          </div>
                          {item.modifierLabels.length > 0 && (
                            <div className="text-xs text-slate-500 truncate">
                              {item.modifierLabels.join(', ')}
                            </div>
                          )}
                          <div className="text-xs text-slate-500 mt-0.5">
                            {t('progressive.unitsRemaining', {
                              paid: item.paidQuantity,
                              total: item.quantity,
                            })}{' '}
                            · {formatCurrency(unitTotal)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => stepDown(item)}
                            disabled={selectedQty === 0}
                            className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-30 flex items-center justify-center"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <div className="w-8 text-center font-semibold text-slate-900">
                            {selectedQty}
                          </div>
                          <button
                            type="button"
                            onClick={() => stepUp(item)}
                            disabled={selectedQty >= item.remainingQuantity}
                            className="w-9 h-9 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-30 flex items-center justify-center"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Paid items list (collapsed feel) */}
            {paidItems.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-slate-500">
                  {t('progressive.paidItems')}
                </h3>
                <div className="space-y-1 max-h-32 overflow-y-auto pr-1 opacity-80">
                  {paidItems.map((item) => (
                    <div
                      key={item.orderItemId}
                      className="flex items-center gap-2 text-xs text-slate-600 px-3 py-1.5 bg-emerald-50/60 rounded-lg"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      <span className="truncate flex-1">{item.productName}</span>
                      <span>
                        {t('progressive.unitsRemaining', {
                          paid: item.paidQuantity,
                          total: item.quantity,
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Selected total */}
            {!allPaid && (
              <div className="flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-3">
                <span className="text-sm font-medium text-indigo-900">
                  {t('progressive.selectedTotal')}
                </span>
                <span className="text-xl font-bold text-indigo-700">
                  {formatCurrency(selectedTotal)}
                </span>
              </div>
            )}

            {/* Customer label */}
            {!allPaid && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  {t('progressive.customerLabel')}
                </label>
                <input
                  type="text"
                  value={customerLabel}
                  onChange={(e) => setCustomerLabel(e.target.value.slice(0, 120))}
                  placeholder={t('progressive.customerLabelPlaceholder')}
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            )}

            {/* Payment method picker */}
            {!allPaid && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  {t('billSplit.paymentMethod')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {METHODS.map(({ value, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMethod(value)}
                      className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 transition-all ${
                        method === value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 hover:border-slate-300 text-slate-600'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-sm font-medium">
                        {t(`progressive.method.${value}`)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Transaction ID for non-cash */}
            {!allPaid && method !== 'CASH' && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  {t('progressive.transactionId')}
                </label>
                <input
                  type="text"
                  value={transactionId}
                  onChange={(e) => setTransactionId(e.target.value.slice(0, 128))}
                  className="w-full h-11 px-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2 border-t border-slate-100">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={payByItems.isPending}
            className="flex-1"
          >
            {allPaid ? t('progressive.done') : t('progressive.cancel')}
          </Button>
          {!allPaid && (
            <Button
              variant="primary"
              onClick={() => submit(false)}
              disabled={submitDisabled}
              isLoading={payByItems.isPending}
              className="flex-1"
            >
              {t('progressive.payAndContinue')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ProgressiveSplitModal;
