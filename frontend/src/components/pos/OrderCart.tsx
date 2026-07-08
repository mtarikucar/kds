import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Plus, Minus, ArrowRightLeft, ShoppingCart, Combine, Split, Users, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Product, ComboSelectionInput } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { calculateItemTotal, calculateSubtotal } from '../../pages/pos/posCart';
import type { SelectedModifier } from './ProductOptionsModal';

interface CartItem extends Product {
  quantity: number;
  notes?: string;
  modifiers?: SelectedModifier[];
  comboSelections?: ComboSelectionInput[];
}

interface OrderCartProps {
  items: CartItem[];
  discount: number;
  customerName: string;
  orderNotes: string;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onUpdateDiscount: (discount: number) => void;
  onUpdateCustomerName: (name: string) => void;
  onUpdateOrderNotes: (notes: string) => void;
  onClearCart: () => void;
  onCheckout: () => void;
  onCreateOrder: () => void;
  onTransferTable?: () => void;
  onMergeTables?: () => void;
  onSplitBill?: () => void;
  onProgressivePay?: () => void;
  isCheckingOut?: boolean;
  isTwoStepCheckout?: boolean;
  hasActiveOrder?: boolean;
  hasSelectedTable?: boolean;
  canProceedToPayment?: boolean;
  paymentBlockedReason?: string | null;
  // deep-review FH2: true when the cart/discount/notes diverged from the saved
  // order. Disables "Proceed to Payment" so the cashier is steered to "Update
  // Order" first — otherwise two-step checkout would charge the stale server
  // amount and drop the newly added items from the bill/kitchen.
  cartDirty?: boolean;
}

const OrderCart = ({
  items,
  discount,
  customerName,
  orderNotes,
  onUpdateQuantity,
  onRemoveItem,
  onUpdateDiscount,
  onUpdateCustomerName,
  onUpdateOrderNotes,
  onClearCart,
  onCheckout,
  onCreateOrder,
  onTransferTable,
  onMergeTables,
  onSplitBill,
  onProgressivePay,
  isCheckingOut = false,
  isTwoStepCheckout = false,
  hasActiveOrder = false,
  hasSelectedTable = false,
  canProceedToPayment = true,
  paymentBlockedReason = null,
  cartDirty = false,
}: OrderCartProps) => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();
  // Subtotal via the shared, tested money-math helper so modifier prices are
  // included (the old inline `price * quantity` silently dropped them).
  const subtotal = calculateSubtotal(items);
  const total = subtotal - discount;

  // Optional customer-name / notes / discount inputs are collapsed behind a
  // disclosure so the fast path (add → pay) stays unobstructed. Auto-open it
  // when any detail already has a value so a loaded order doesn't hide them.
  const hasDetails = !!customerName || !!orderNotes || discount > 0;
  const [showDetails, setShowDetails] = useState(false);
  const detailsOpen = showDetails || hasDetails;

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-slate-500" />
          {t('currentOrder')}
        </CardTitle>
        <div className="flex gap-2">
          {/* Table Actions */}
          {hasSelectedTable && onMergeTables && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMergeTables}
              title={t('tableMerge.mergeButton')}
              className="text-slate-500 hover:text-indigo-600"
            >
              <Combine className="h-4 w-4" />
            </Button>
          )}
          {hasActiveOrder && hasSelectedTable && onSplitBill && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSplitBill}
              title={t('billSplit.splitButton')}
              // Label alongside the icon so a waiter on a tablet (where
              // title tooltips don't trigger on touch) can tell the
              // split-bill and pay-by-customer buttons apart.
              className="text-slate-500 hover:text-emerald-600 gap-1.5"
            >
              <Split className="h-4 w-4" />
              <span className="hidden sm:inline text-xs font-medium">
                {t('billSplit.splitButton')}
              </span>
            </Button>
          )}
          {hasActiveOrder && hasSelectedTable && onProgressivePay && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onProgressivePay}
              title={t('progressive.buttonTitle')}
              className="text-slate-500 hover:text-indigo-600 gap-1.5"
            >
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline text-xs font-medium">
                {t('progressive.buttonTitle')}
              </span>
            </Button>
          )}
          {hasActiveOrder && hasSelectedTable && onTransferTable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onTransferTable}
              title={t('transfer.buttonTitle')}
              className="text-slate-500 hover:text-slate-700"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </Button>
          )}
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearCart} className="text-slate-500 hover:text-red-600">
              {t('clearAll')}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
        {items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <ShoppingCart className="h-8 w-8 text-slate-300" />
            </div>
            <p className="text-sm">{t('noItemsInCart')}</p>
          </div>
        ) : (
          <>
            {/* Cart Items - Scrollable area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
              {items.map((item) => {
                const lineModifiers = item.modifiers ?? [];
                const lineTotal = calculateItemTotal(
                  Number(item.price),
                  lineModifiers,
                  item.quantity,
                );
                return (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 bg-slate-50/80 rounded-xl border border-slate-100"
                >
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-slate-900 truncate">{item.name}</h4>
                    {/* Combo components as sub-text (resolved from the product's
                        combo slots + the line's chosen selections). */}
                    {item.comboSelections && item.comboSelections.length > 0 && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {item.comboSelections
                          .map((sel) => {
                            for (const g of item.comboGroups ?? []) {
                              const it = g.items.find(
                                (i) =>
                                  i.componentProductId ===
                                  sel.componentProductId,
                              );
                              if (it) return it.name || '';
                            }
                            return '';
                          })
                          .filter(Boolean)
                          .join(' + ')}
                      </p>
                    )}
                    {/* Selected modifiers as sub-text */}
                    {lineModifiers.length > 0 && (
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {lineModifiers
                          .map((m) =>
                            m.quantity > 1 ? `${m.name} ×${m.quantity}` : m.name,
                          )
                          .join(', ')}
                      </p>
                    )}
                    <p className="text-sm text-slate-500 mt-0.5">
                      {formatPrice(item.price)} × {item.quantity}
                      {/* Line extended total (incl. modifiers) */}
                      <span className="text-slate-700 font-medium"> = {formatPrice(lineTotal)}</span>
                    </p>
                  </div>

                  <div className="flex items-center gap-2 ml-3">
                    <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-0.5">
                      <button
                        onClick={() => onUpdateQuantity(item.id, Math.max(1, item.quantity - 1))}
                        className="p-1.5 rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-8 text-center font-medium text-sm text-slate-900">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        className="p-1.5 rounded-md hover:bg-slate-100 transition-colors text-slate-600"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => onRemoveItem(item.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>

            {/* Optional details — collapsed behind a disclosure so the fast
                path (add → pay) is unobstructed. */}
            <div className="flex-shrink-0 px-4 pt-3 border-t border-slate-100 bg-slate-50/30">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={detailsOpen}
                className="w-full flex items-center justify-between gap-2 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4" />
                  {t('addDetails', 'Detay ekle')}
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {detailsOpen && (
                <div className="space-y-4 pb-3 pt-1">
                  <Input
                    label={t('customerNameLabel')}
                    type="text"
                    placeholder={t('customerNamePlaceholder')}
                    value={customerName}
                    onChange={(e) => onUpdateCustomerName(e.target.value)}
                  />

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-slate-700">
                      {t('orderNotesLabel')}
                    </label>
                    <textarea
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-all text-sm resize-none shadow-sm"
                      placeholder={t('orderNotesPlaceholder')}
                      rows={2}
                      value={orderNotes}
                      onChange={(e) => onUpdateOrderNotes(e.target.value)}
                    />
                  </div>

                  <Input
                    label={t('discount')}
                    type="number"
                    min="0"
                    max={subtotal}
                    step="0.01"
                    value={discount}
                    // `min`/`max` HTML attributes are advisory only and not
                    // enforced by mobile keyboards — a user typing `-50` would
                    // sail through. Clamp on every keystroke so the discount
                    // can never go negative (creating a surcharge / negative
                    // payment downstream) or exceed the subtotal.
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value) || 0;
                      onUpdateDiscount(Math.max(0, Math.min(raw, subtotal)));
                    }}
                  />
                </div>
              )}
            </div>

            {/* STICKY CHECKOUT FOOTER — total + primary CTA always visible. */}
            <div className="flex-shrink-0 sticky bottom-0 p-4 space-y-3 border-t border-slate-200 bg-white/95 backdrop-blur-md shadow-[0_-2px_8px_rgba(15,23,42,0.04)]">
              {discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">{t('subtotal')}:</span>
                  <span className="font-medium text-slate-900">{formatPrice(subtotal)}</span>
                </div>
              )}

              {/* TOTAL — the single most important number on the screen, so
                  it's the largest/boldest element in the footer. */}
              <div className="flex items-end justify-between">
                <span className="text-sm font-medium text-slate-500">{t('total')}</span>
                <span className="text-3xl font-extrabold text-primary-600 tabular-nums leading-none">
                  {formatPrice(total)}
                </span>
              </div>

              {/* Conditional button rendering based on checkout mode */}
              {isTwoStepCheckout ? (
                <div className="space-y-2">
                  {/* Create Order button */}
                  <Button
                    variant="secondary"
                    className="w-full"
                    size="lg"
                    onClick={onCreateOrder}
                    isLoading={isCheckingOut}
                    disabled={hasActiveOrder && items.length === 0}
                  >
                    {hasActiveOrder ? t('updateOrder') : t('createOrder')}
                  </Button>

                  {/* Payment button - uses canProceedToPayment for eligibility.
                      deep-review FH2: also blocked while the cart diverged from
                      the saved order, so we never charge the stale amount.
                      Tall (h-14) primary tap target — the page's main action. */}
                  <Button
                    variant="primary"
                    className="w-full h-14 text-base font-semibold"
                    size="lg"
                    onClick={onCheckout}
                    disabled={!hasActiveOrder || !canProceedToPayment || cartDirty}
                  >
                    {t('proceedToPayment')}
                  </Button>

                  {/* deep-review FH2: steer the cashier to re-sync first. */}
                  {hasActiveOrder && canProceedToPayment && cartDirty && (
                    <p className="text-sm text-amber-600 text-center">
                      {t('updateOrderBeforePayment', 'Önce siparişi güncelleyin')}
                    </p>
                  )}

                  {/* Show blocked reason when payment not allowed */}
                  {hasActiveOrder && !canProceedToPayment && paymentBlockedReason && (
                    <p className="text-sm text-amber-600 text-center">
                      {t(paymentBlockedReason)}
                    </p>
                  )}
                </div>
              ) : (
                /* Single-step checkout button — tall primary tap target. */
                <Button
                  variant="primary"
                  className="w-full h-14 text-base font-semibold"
                  size="lg"
                  onClick={onCheckout}
                  isLoading={isCheckingOut}
                >
                  {t('checkout')}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default OrderCart;
