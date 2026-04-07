import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Split, Plus, Trash2, Banknote, CreditCard, Smartphone, Users, List, DollarSign } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { Order, SplitType, SplitPaymentEntry } from '../../types';

interface BillSplitModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: Order[];
  onConfirm: (orderId: string, splitType: SplitType, payments: SplitPaymentEntry[]) => Promise<void> | void;
  isLoading?: boolean;
}

interface SplitEntry {
  label: string;
  amount: number;
  method: string;
  selectedItemIds: string[];
}

const METHODS = [
  { value: 'CASH', icon: Banknote, label: 'Cash' },
  { value: 'CARD', icon: CreditCard, label: 'Card' },
  { value: 'DIGITAL', icon: Smartphone, label: 'Digital' },
];

const BillSplitModal = ({
  isOpen,
  onClose,
  orders,
  onConfirm,
  isLoading = false,
}: BillSplitModalProps) => {
  const { t } = useTranslation('pos');
  const formatCurrency = useFormatCurrency();
  const [splitType, setSplitType] = useState<SplitType>('EQUAL');
  const [numberOfPeople, setNumberOfPeople] = useState(2);
  const [equalMethods, setEqualMethods] = useState<string[]>(['CASH', 'CASH']);
  const [entries, setEntries] = useState<SplitEntry[]>([
    { label: `${t('billSplit.person')} 1`, amount: 0, method: 'CASH', selectedItemIds: [] },
    { label: `${t('billSplit.person')} 2`, amount: 0, method: 'CASH', selectedItemIds: [] },
  ]);

  // Combine all unpaid order amounts
  const activeOrders = orders.filter(o => o.status !== 'PAID' && o.status !== 'CANCELLED');
  const totalAmount = activeOrders.reduce((sum, o) => sum + Number(o.finalAmount), 0);
  const allItems = activeOrders.flatMap(o =>
    (o.orderItems || []).map(item => ({ ...item, orderId: o.id }))
  );

  // Reset state when modal reopens
  useEffect(() => {
    if (isOpen) {
      setSplitType('EQUAL');
      setNumberOfPeople(2);
      setEqualMethods(['CASH', 'CASH']);
      setEntries([
        { label: `${t('billSplit.person')} 1`, amount: 0, method: 'CASH', selectedItemIds: [] },
        { label: `${t('billSplit.person')} 2`, amount: 0, method: 'CASH', selectedItemIds: [] },
      ]);
    }
  }, [isOpen, t]);

  // Sync equalMethods array with numberOfPeople
  useEffect(() => {
    setEqualMethods(prev => {
      if (prev.length === numberOfPeople) return prev;
      if (prev.length < numberOfPeople) {
        return [...prev, ...Array(numberOfPeople - prev.length).fill('CASH')];
      }
      return prev.slice(0, numberOfPeople);
    });
  }, [numberOfPeople]);

  // Calculate per-person amounts for equal split (last person absorbs remainder)
  const equalAmounts = useMemo(() => {
    if (splitType !== 'EQUAL' || numberOfPeople < 2) return [];
    const base = Math.floor((totalAmount / numberOfPeople) * 100) / 100;
    const amounts = Array(numberOfPeople).fill(base);
    // Last person absorbs the rounding remainder
    amounts[numberOfPeople - 1] = Math.round((totalAmount - base * (numberOfPeople - 1)) * 100) / 100;
    return amounts;
  }, [totalAmount, numberOfPeople, splitType]);

  const totalSplit = useMemo(() => {
    if (splitType === 'EQUAL') return totalAmount; // Always exact with remainder logic
    return entries.reduce((sum, e) => sum + e.amount, 0);
  }, [splitType, entries, totalAmount]);

  const remaining = totalAmount - totalSplit;

  const addEntry = () => {
    setEntries(prev => [
      ...prev,
      { label: `${t('billSplit.person')} ${prev.length + 1}`, amount: 0, method: 'CASH', selectedItemIds: [] },
    ]);
  };

  const removeEntry = (index: number) => {
    if (entries.length <= 2) return;
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: keyof SplitEntry, value: any) => {
    setEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  };

  const toggleItemForEntry = (entryIndex: number, itemId: string) => {
    setEntries(prev => prev.map((e, i) => {
      if (i !== entryIndex) return e;
      const ids = e.selectedItemIds.includes(itemId)
        ? e.selectedItemIds.filter(id => id !== itemId)
        : [...e.selectedItemIds, itemId];
      const amount = ids.reduce((sum, id) => {
        const item = allItems.find(it => it.id === id);
        return sum + (item ? Number(item.subtotal) : 0);
      }, 0);
      return { ...e, selectedItemIds: ids, amount };
    }));
  };

  const handleConfirm = async () => {
    if (activeOrders.length === 0) return;

    let payments: SplitPaymentEntry[];

    if (splitType === 'EQUAL') {
      payments = equalAmounts.map((amount, i) => ({
        amount,
        method: equalMethods[i] || 'CASH',
        label: `${t('billSplit.person')} ${i + 1}`,
      }));
    } else {
      payments = entries.map(e => ({
        amount: e.amount,
        method: e.method,
        label: e.label,
        ...(splitType === 'BY_ITEMS' ? { orderItemIds: e.selectedItemIds } : {}),
      }));
    }

    if (activeOrders.length === 1) {
      await onConfirm(activeOrders[0].id, splitType, payments);
    } else {
      // Multi-order: allocate payments proportionally, sequentially to avoid race conditions
      const sortedOrders = [...activeOrders].sort((a, b) => Number(b.finalAmount) - Number(a.finalAmount));

      let remainingPayments = [...payments];
      for (const order of sortedOrders) {
        const orderAmt = Number(order.finalAmount);
        const orderPayments: SplitPaymentEntry[] = [];
        let allocated = 0;

        for (let i = 0; i < remainingPayments.length && allocated < orderAmt; i++) {
          const p = remainingPayments[i];
          if (p.amount <= 0) continue;

          const canAllocate = Math.min(p.amount, orderAmt - allocated);
          orderPayments.push({ ...p, amount: Math.round(canAllocate * 100) / 100 });
          allocated += canAllocate;
          remainingPayments[i] = { ...p, amount: Math.round((p.amount - canAllocate) * 100) / 100 };
        }

        if (orderPayments.length > 0) {
          await onConfirm(order.id, splitType, orderPayments);
        }

        remainingPayments = remainingPayments.filter(p => p.amount > 0);
      }
    }
  };

  if (!isOpen || activeOrders.length === 0) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('billSplit.title')} size="lg">
      <div className="space-y-5">
        {/* Total */}
        <div className="bg-slate-50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <span className="text-slate-600 font-medium">{t('billSplit.total')}</span>
            {activeOrders.length > 1 && (
              <span className="text-xs text-slate-400 ml-2">({activeOrders.length} orders)</span>
            )}
          </div>
          <span className="text-2xl font-bold text-slate-900">{formatCurrency(totalAmount)}</span>
        </div>

        {/* Split Type Selector */}
        <div>
          <label className="text-sm font-medium text-slate-700 mb-2 block">{t('billSplit.splitType')}</label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { type: 'EQUAL' as SplitType, icon: Users, label: t('billSplit.equal') },
              { type: 'BY_ITEMS' as SplitType, icon: List, label: t('billSplit.byItems') },
              { type: 'CUSTOM' as SplitType, icon: DollarSign, label: t('billSplit.custom') },
            ]).map(({ type, icon: Icon, label }) => (
              <button
                key={type}
                onClick={() => setSplitType(type)}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
                  splitType === type
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* EQUAL SPLIT */}
        {splitType === 'EQUAL' && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-2 block">
                {t('billSplit.numberOfPeople')}
              </label>
              <div className="flex items-center gap-3">
                {[2, 3, 4, 5, 6].map(n => (
                  <button
                    key={n}
                    onClick={() => setNumberOfPeople(n)}
                    className={`w-12 h-12 rounded-xl font-bold text-lg transition-all ${
                      numberOfPeople === n
                        ? 'bg-indigo-500 text-white shadow-md'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {n}
                  </button>
                ))}
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={numberOfPeople}
                  onChange={e => setNumberOfPeople(Math.max(2, parseInt(e.target.value) || 2))}
                  className="w-16 h-12 rounded-xl border border-slate-200 text-center font-bold text-lg"
                />
              </div>
            </div>

            {/* Per-person breakdown with method selection */}
            <div className="space-y-2">
              {equalAmounts.map((amount, i) => (
                <div key={i} className="flex items-center gap-3 bg-indigo-50/60 rounded-xl px-4 py-3">
                  <span className="text-sm font-medium text-indigo-900 flex-1">
                    {t('billSplit.person')} {i + 1}
                  </span>
                  <div className="flex gap-1">
                    {METHODS.map(({ value, icon: MIcon }) => (
                      <button
                        key={value}
                        onClick={() => setEqualMethods(prev => prev.map((m, idx) => idx === i ? value : m))}
                        className={`p-1.5 rounded-lg transition-all ${
                          (equalMethods[i] || 'CASH') === value
                            ? 'bg-indigo-200 text-indigo-700'
                            : 'bg-white/60 text-slate-400 hover:bg-white'
                        }`}
                      >
                        <MIcon className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                  <span className="font-bold text-indigo-700 w-24 text-right">
                    {formatCurrency(amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BY ITEMS SPLIT */}
        {splitType === 'BY_ITEMS' && (
          <div className="space-y-4 max-h-80 overflow-y-auto">
            {entries.map((entry, eIdx) => (
              <div key={eIdx} className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <input
                    value={entry.label}
                    onChange={e => updateEntry(eIdx, 'label', e.target.value)}
                    className="font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-indigo-300 outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-indigo-600">{formatCurrency(entry.amount)}</span>
                    {entries.length > 2 && (
                      <button
                        onClick={() => removeEntry(eIdx)}
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {/* Method selector */}
                <div className="flex gap-1 mb-3">
                  {METHODS.map(({ value, icon: MIcon, label }) => (
                    <button
                      key={value}
                      onClick={() => updateEntry(eIdx, 'method', value)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all ${
                        entry.method === value
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      <MIcon className="h-3 w-3" />
                      {label}
                    </button>
                  ))}
                </div>
                {/* Items */}
                <div className="space-y-1">
                  {allItems.map(item => {
                    const isSelected = entry.selectedItemIds.includes(item.id);
                    const isUsedByOther = !isSelected && entries.some((e, i) => i !== eIdx && e.selectedItemIds.includes(item.id));
                    return (
                      <button
                        key={`${eIdx}-${item.id}`}
                        onClick={() => !isUsedByOther && toggleItemForEntry(eIdx, item.id)}
                        disabled={isUsedByOther}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ${
                          isSelected
                            ? 'bg-indigo-50 border border-indigo-200 text-indigo-900'
                            : isUsedByOther
                              ? 'bg-slate-50 text-slate-300 cursor-not-allowed'
                              : 'bg-white border border-slate-100 hover:border-slate-200 text-slate-700'
                        }`}
                      >
                        <span>{item.quantity}x {item.product?.name}</span>
                        <span className="font-medium">{formatCurrency(Number(item.subtotal))}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addEntry} className="w-full">
              <Plus className="h-4 w-4 mr-1" /> {t('billSplit.addSplit')}
            </Button>
          </div>
        )}

        {/* CUSTOM SPLIT */}
        {splitType === 'CUSTOM' && (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {entries.map((entry, eIdx) => (
              <div key={eIdx} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                <input
                  value={entry.label}
                  onChange={e => updateEntry(eIdx, 'label', e.target.value)}
                  className="flex-1 min-w-0 text-sm font-medium bg-white rounded-lg px-3 py-2 border border-slate-200"
                />
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={entry.amount || ''}
                  onChange={e => updateEntry(eIdx, 'amount', parseFloat(e.target.value) || 0)}
                  placeholder={t('billSplit.amount')}
                  className="w-28 text-sm font-bold bg-white rounded-lg px-3 py-2 border border-slate-200 text-right"
                />
                <div className="flex gap-1">
                  {METHODS.map(({ value, icon: MIcon }) => (
                    <button
                      key={value}
                      onClick={() => updateEntry(eIdx, 'method', value)}
                      className={`p-2 rounded-lg transition-all ${
                        entry.method === value
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-white text-slate-400 hover:bg-slate-100'
                      }`}
                    >
                      <MIcon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
                {entries.length > 2 && (
                  <button
                    onClick={() => removeEntry(eIdx)}
                    className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addEntry} className="w-full">
              <Plus className="h-4 w-4 mr-1" /> {t('billSplit.addSplit')}
            </Button>
          </div>
        )}

        {/* Remaining indicator */}
        {splitType !== 'EQUAL' && (
          <div className={`flex items-center justify-between px-4 py-3 rounded-xl ${
            Math.abs(remaining) < 0.01 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            <span className="text-sm font-medium">{t('billSplit.remaining')}</span>
            <span className="font-bold">{formatCurrency(Math.max(0, remaining))}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            {t('common:common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={isLoading || (splitType !== 'EQUAL' && Math.abs(remaining) > 0.01 && remaining > 0)}
          >
            {isLoading ? (
              <Spinner size="sm" color="white" />
            ) : (
              <>
                <Split className="h-4 w-4 mr-2" />
                {t('billSplit.collectAll')}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default BillSplitModal;
