import { OrderType, OrderStatus, type Order, type OrderItem, type Product } from '../../types';
import type { SelectedModifier } from '../../components/pos/ProductOptionsModal';
import type { CartItem } from './posTypes';

/**
 * POS cart pure logic — money math + payment-eligibility gates.
 *
 * These were previously inline in POSPage.tsx (subtotal reduce ~L868,
 * canProceedToPayment/paymentBlockedReason memos ~L242-274). The subtotal
 * reduce was a hand-rolled duplicate of cartStore.ts `calculateItemTotal`;
 * lifting it here gives a single tested money-math surface and lets the
 * page call the same logic from the same render lines (behavior-preserving).
 *
 * NOTE on the cart-item shape used by POSPage: it is a `Product` spread with
 * `quantity` + an optional `modifiers: SelectedModifier[]`. SelectedModifier
 * carries `priceAdjustment` and `quantity` per modifier. This differs from
 * the customer cartStore `CartModifier` shape, but the arithmetic is identical
 * — `(price + Σ(modPriceAdj * modQty)) * itemQty`.
 */

/** Minimal shape POSPage's cart items satisfy for total math. */
export interface PosCartItem {
  price: number | string;
  quantity: number;
  modifiers?: SelectedModifier[];
}

/**
 * Total contribution of a single cart line, modifiers included.
 * Mirrors cartStore.ts calculateItemTotal exactly so the two code paths
 * can never drift on price arithmetic.
 */
export function calculateItemTotal(
  productPrice: number,
  modifiers: SelectedModifier[],
  quantity: number,
): number {
  const modifierTotal = modifiers.reduce(
    (sum, mod) => sum + mod.priceAdjustment * mod.quantity,
    0,
  );
  return (productPrice + modifierTotal) * quantity;
}

/**
 * Cart subtotal across all lines. `item.price` may arrive as a string from
 * the API (decimal columns serialize as strings), so it is coerced via
 * Number() — preserving the previous inline `Number(item.price)` behavior.
 */
export function calculateSubtotal(items: PosCartItem[]): number {
  return items.reduce(
    (sum, item) =>
      sum + calculateItemTotal(Number(item.price), item.modifiers || [], item.quantity),
    0,
  );
}

/** Final total after a flat discount. Matches `subtotal - discount`. */
export function calculateTotal(items: PosCartItem[], discount: number): number {
  return calculateSubtotal(items) - discount;
}

/**
 * Change due ("para üstü") for a cash payment: how much to hand back when the
 * customer tenders `tendered` against an order `total`.
 *
 * Rules:
 *  - Never negative — if the customer under-pays (tendered < total) the change
 *    is 0, not a negative number. The UI separately blocks confirm in that case
 *    (see `isTenderSufficient`), but the math stays clamped regardless.
 *  - Exact payment → 0.
 *  - Over payment → tendered − total.
 *  - Rounded to 2 decimals so floating-point noise (e.g. 0.1 + 0.2) never leaks
 *    a 0.30000000000000004-style value into the displayed change.
 *
 * Pure money math kept here so it shares the same tested surface as the rest
 * of the cart arithmetic.
 */
export function computeChangeDue(total: number, tendered: number): number {
  const diff = tendered - total;
  if (diff <= 0) return 0;
  return Math.round(diff * 100) / 100;
}

/**
 * Whether the tendered cash covers the order total. A separate predicate from
 * `computeChangeDue` so the confirm-button gate and the change display can't
 * drift. Equal amounts (exact payment) are sufficient.
 *
 * Compared in integer cents: `total` is a client-summed float (see
 * calculateSubtotal), so a raw `tendered >= total` would REJECT an exact
 * payment when the sum carries float noise (e.g. 0.1 + 0.2 = 0.30000000000000004
 * vs a tendered 0.30) — even though computeChangeDue, which rounds, treats the
 * same pair as fully covered (change 0). Rounding both sides to cents keeps the
 * gate and the change display consistent.
 */
export function isTenderSufficient(total: number, tendered: number): boolean {
  return Math.round(tendered * 100) >= Math.round(total * 100);
}

/**
 * Stable identity key for a cart line: product id is implicit (caller already
 * matched on it); this keys the *modifier set* so the same product with
 * different modifiers stays a separate line. Modifier ids are sorted so order
 * of selection doesn't matter. Pure extraction of the inline `modifierKey`.
 */
function modifierKeyOf(modifiers: { modifierId: string }[]): string {
  return modifiers
    .map((m) => m.modifierId)
    .sort()
    .join('-');
}

/**
 * Add `quantity` of `product` (with `modifiers`) to `prev`, returning the new
 * cart array. If a line already exists for the same product AND the same
 * modifier set, its quantity is incremented; otherwise a new line is appended.
 * Pure extraction of POSPage.addItemToCart's setCartItems updater so the
 * dedup/merge rule (modifier-order-insensitive) is unit-testable.
 */
export function mergeCartItem(
  prev: CartItem[],
  product: Product,
  quantity: number,
  modifiers: SelectedModifier[],
): CartItem[] {
  const key = modifierKeyOf(modifiers);
  const existingItem = prev.find(
    (item) =>
      item.id === product.id && modifierKeyOf(item.modifiers || []) === key,
  );

  if (existingItem) {
    return prev.map((item) =>
      item === existingItem
        ? { ...item, quantity: item.quantity + quantity }
        : item,
    );
  }
  return [...prev, { ...product, quantity, modifiers }];
}

/**
 * Two-step-checkout payment eligibility. Pure extraction of POSPage's
 * canProceedToPayment memo (~L242-259).
 *
 * - No active order  → cannot proceed.
 * - TAKEAWAY/DELIVERY → always allowed.
 * - DINE_IN          → if requireServedForDineInPayment, only when the order
 *                      is SERVED or READY; otherwise always allowed.
 */
export function canProceedToPayment(args: {
  currentOrderId: string | null;
  currentOrder: Order | null;
  requireServedForDineInPayment: boolean;
}): boolean {
  const { currentOrderId, currentOrder, requireServedForDineInPayment } = args;

  // Must have an active order to proceed to payment
  if (!currentOrderId || !currentOrder) return false;

  // Takeaway and delivery orders can always proceed to payment
  const orderType = currentOrder.type || OrderType.DINE_IN;
  if (orderType === OrderType.TAKEAWAY || orderType === OrderType.DELIVERY) {
    return true;
  }

  // For dine-in, check if SERVED/READY status is required
  if (requireServedForDineInPayment) {
    return (
      currentOrder.status === OrderStatus.SERVED ||
      currentOrder.status === OrderStatus.READY
    );
  }

  // Setting is off - allow payment anytime
  return true;
}

/**
 * Reason payment is blocked, for user feedback. Pure extraction of POSPage's
 * paymentBlockedReason memo (~L262-274). Returns null when payment may proceed
 * or when no specific reason applies.
 */
export function paymentBlockedReason(args: {
  currentOrderId: string | null;
  currentOrder: Order | null;
  requireServedForDineInPayment: boolean;
}): 'noActiveOrder' | 'dineInPaymentRequiresReadyOrServed' | null {
  const { currentOrderId, currentOrder, requireServedForDineInPayment } = args;

  if (canProceedToPayment(args)) return null;
  if (!currentOrderId) return 'noActiveOrder';
  if (
    requireServedForDineInPayment &&
    currentOrder?.type === OrderType.DINE_IN &&
    currentOrder?.status !== OrderStatus.SERVED &&
    currentOrder?.status !== OrderStatus.READY
  ) {
    return 'dineInPaymentRequiresReadyOrServed';
  }
  return null;
}

/**
 * Resolve which order + amount handlePaymentConfirm should charge. The
 * AwaitingPayment section pays a specific SERVED/READY order (payingOrderId);
 * otherwise the active cart order (currentOrderId) is paid. Returns null when
 * there is nothing chargeable (no order id, or a null amount) — POSPage's
 * inline guard short-circuited on exactly this. Pure extraction of the
 * `orderIdToPay`/`amountToPay`/early-return lines (~L605-609).
 */
export function resolvePaymentTarget(args: {
  payingOrderId: string | null;
  payingOrderAmount: number | null;
  currentOrderId: string | null;
  currentOrderAmount: number | null;
}): { orderId: string; amount: number; wasExistingOrderPayment: boolean } | null {
  const { payingOrderId, payingOrderAmount, currentOrderId, currentOrderAmount } = args;
  const orderId = payingOrderId || currentOrderId;
  const amount = payingOrderId ? payingOrderAmount : currentOrderAmount;
  if (!orderId || amount === null) return null;
  return { orderId, amount, wasExistingOrderPayment: !!payingOrderId };
}

/**
 * Whether any unpaid order remains on the table after `paidOrderId` is
 * settled — the guard that decides if the table can be freed to AVAILABLE.
 * Excludes the just-paid order, PAID orders, and CANCELLED orders. Must run
 * against freshly-refetched orders (a stale snapshot could free a table that
 * still has an unpaid bill — the documented race this guards). Pure
 * extraction of the `remainingOrders` filter (~L626-633).
 */
export function hasRemainingUnpaidOrders(
  orders: Pick<Order, 'id' | 'status'>[],
  paidOrderId: string,
): boolean {
  return orders.some(
    (order) =>
      order.id !== paidOrderId &&
      order.status !== OrderStatus.PAID &&
      order.status !== OrderStatus.CANCELLED,
  );
}

/**
 * Map an existing order's line items into POS cart items when continuing an
 * occupied table's order. Spreads the product, carries quantity, and coerces
 * an empty/null note to undefined. Pure extraction of the OCCUPIED-load
 * effect's mapping (~L228-233). Reads `orderItems` then falls back to `items`,
 * matching the original `activeOrder.orderItems || activeOrder.items || []`.
 */
export function mapOrderItemsToCart(
  order: Pick<Order, 'orderItems' | 'items'>,
): CartItem[] {
  const items: OrderItem[] = order.orderItems || order.items || [];
  return items.map((item) => ({
    ...(item.product as Product),
    quantity: item.quantity,
    notes: item.notes || undefined,
    // deep-review FH3: round-trip line-item modifiers into the SelectedModifier
    // shape the cart + buildOrderData expect. Without this, continuing an
    // OCCUPIED table's order stripped every paid modifier (wrong kitchen
    // ticket + undercharge). priceAdjustment may serialize as a string from the
    // Decimal column, hence Number(...). `name` is display-only; buildOrderData
    // re-emits only {modifierId, quantity} and the backend re-prices server-side.
    modifiers: item.modifiers?.map((m) => ({
      modifierId: m.modifierId,
      name: m.modifier?.name ?? '',
      priceAdjustment: Number(m.priceAdjustment),
      quantity: m.quantity,
    })),
  }));
}
