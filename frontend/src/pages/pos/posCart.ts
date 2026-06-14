import { OrderType, OrderStatus, type Order, type Product } from '../../types';
import type { SelectedModifier } from '../../components/pos/ProductOptionsModal';

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
