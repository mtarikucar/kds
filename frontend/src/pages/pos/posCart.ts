import { OrderType, OrderStatus, PaymentStatus, type Order, type OrderItem, type Product } from '../../types';
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
 * Sum of COMPLETED payments already recorded on an order. `payments` rides on
 * every /orders list row (ORDER_DETAIL_INCLUDE serializes it); amounts may
 * arrive as strings (Prisma Decimal) → Number(). Non-COMPLETED rows (PENDING/
 * FAILED/REFUNDED) don't count — mirrors the backend's remaining-validation
 * aggregate (payments.service, status: COMPLETED), so the two sides can never
 * disagree on what "already paid" means. Kuruş-rounded like computeChangeDue.
 */
export function orderPaidAmount(order: Pick<Order, 'payments'>): number {
  const paid = (order.payments ?? []).reduce(
    (sum, p) =>
      p.status === PaymentStatus.COMPLETED ? sum + Number(p.amount) : sum,
    0,
  );
  return Math.round(paid * 100) / 100;
}

/**
 * True balance still owed on an order — what "collect payment" must charge.
 * After a partial/progressive payment the backend rejects anything above this
 * ("Payment amount exceeds remaining"), so charging the gross finalAmount
 * dead-ends the cashier with no way to settle the bill. Clamped at 0 (an
 * over-paid order owes nothing) and kuruş-rounded against float noise.
 */
export function orderRemainingDue(
  order: Pick<Order, 'finalAmount' | 'payments'>,
): number {
  const remaining = Number(order.finalAmount) - orderPaidAmount(order);
  return Math.max(0, Math.round(remaining * 100) / 100);
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

/** Stable key for a combo's slot picks so different combos stay separate lines. */
function comboKeyOf(
  sel?: { groupId: string; componentProductId: string }[],
): string {
  return (sel ?? [])
    .map((s) => `${s.groupId}:${s.componentProductId}`)
    .sort()
    .join('|');
}

/**
 * Client-only cart-line identity: product + modifier set + combo picks —
 * EXACTLY the keys mergeCartItem merges on, so "same lineId" ⇔ "would merge".
 * Line-level operations (update qty / remove / React keys) must target this,
 * never the bare product id: two lines of the same product with different
 * modifiers are distinct bills, and a product-id update/remove corrupted both.
 */
export function computeCartLineId(
  productId: string,
  modifiers?: { modifierId: string }[],
  comboSelections?: { groupId: string; componentProductId: string }[],
): string {
  return `${productId}::${modifierKeyOf(modifiers ?? [])}::${comboKeyOf(comboSelections)}`;
}

/**
 * Resolve a line's id, deriving it for legacy lines that lack one (a persisted
 * pre-lineId cart that slipped past normalizeCartLines still targets correctly).
 */
export function getCartLineId(
  item: Pick<CartItem, 'id' | 'lineId' | 'modifiers' | 'comboSelections'>,
): string {
  return (
    item.lineId ?? computeCartLineId(item.id, item.modifiers, item.comboSelections)
  );
}

/**
 * Backfill `lineId` on carts persisted before line identity existed
 * (localStorage back-compat) and on order-loaded lines. Deterministic —
 * derived from the same merge keys — with an index suffix when two lines
 * share an identity (possible when a reopened order carried duplicate item
 * rows), so React keys and line targeting stay unique.
 */
export function normalizeCartLines(items: CartItem[]): CartItem[] {
  const taken = new Set<string>();
  return items.map((item) => {
    const base = getCartLineId(item);
    let lineId = base;
    for (let n = 2; taken.has(lineId); n++) lineId = `${base}::${n}`;
    taken.add(lineId);
    return lineId === item.lineId ? item : { ...item, lineId };
  });
}

/** Set a line's quantity by lineId, leaving sibling lines of the same product intact. */
export function updateLineQuantity(
  prev: CartItem[],
  lineId: string,
  quantity: number,
): CartItem[] {
  return prev.map((item) =>
    getCartLineId(item) === lineId ? { ...item, quantity } : item,
  );
}

/** Remove exactly one line by lineId (never every line of the product). */
export function removeLine(prev: CartItem[], lineId: string): CartItem[] {
  return prev.filter((item) => getCartLineId(item) !== lineId);
}

/**
 * Resolve which line a MenuPanel inline stepper targets. Steppers pass a bare
 * PRODUCT id and only render for simple products (no required modifiers,
 * never combos), which merge into one plain line — but a reopened order can
 * put an optional-modifier line of the same product in the cart. Prefer the
 * plain line (the one a card-tap add merges into); fall back to a sole line;
 * when several modifier lines make the target ambiguous, touch nothing rather
 * than corrupt sibling lines.
 */
export function stepProductLine(
  prev: CartItem[],
  productId: string,
  delta: 1 | -1,
): CartItem[] {
  const matches = prev.filter((item) => item.id === productId);
  const plainKey = computeCartLineId(productId, [], undefined);
  const target =
    matches.find(
      (item) =>
        computeCartLineId(item.id, item.modifiers, item.comboSelections) ===
        plainKey,
    ) ?? (matches.length === 1 ? matches[0] : undefined);
  if (!target) return prev;
  return prev.flatMap((item) => {
    if (item !== target) return [item];
    const quantity = item.quantity + delta;
    // Drop the line when it would hit zero, otherwise adjust.
    return quantity < 1 ? [] : [{ ...item, quantity }];
  });
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
  comboSelections?: { groupId: string; componentProductId: string }[],
): CartItem[] {
  const key = modifierKeyOf(modifiers);
  const ckey = comboKeyOf(comboSelections);
  const existingItem = prev.find(
    (item) =>
      item.id === product.id &&
      modifierKeyOf(item.modifiers || []) === key &&
      comboKeyOf(item.comboSelections) === ckey,
  );

  if (existingItem) {
    return prev.map((item) =>
      item === existingItem
        ? { ...item, quantity: item.quantity + quantity }
        : item,
    );
  }
  // Collision-free: a line sharing this identity would have merged above.
  return [
    ...prev,
    {
      ...product,
      quantity,
      modifiers,
      comboSelections,
      lineId: computeCartLineId(product.id, modifiers, comboSelections),
    },
  ];
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
 * Whether any unpaid order remains on the table after a payment settles —
 * the guard that decides if the table can be freed to AVAILABLE. Must run
 * against freshly-refetched, status-filtered orders (a stale snapshot could
 * free a table that still has an unpaid bill — the documented race this
 * guards). The refetched list is authoritative as-is: a fully paid order has
 * already dropped out of it, while a PARTIALLY paid one remains and must
 * block the release — the old excluded-`paidOrderId` parameter hid exactly
 * that case, freeing the table with an open balance.
 */
export function hasRemainingUnpaidOrders(
  orders: Pick<Order, 'status'>[],
): boolean {
  return orders.some(
    (order) =>
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

  // Combo lines are stored as a 0₺ parent + qty-1 children. Re-group them into
  // ONE cart line priced at the combo package total (Σ children subtotal) so a
  // reopened OCCUPIED table shows the real total — NOT the parent's catalog
  // price PLUS every component at its own catalog price (a gross overcharge).
  const childrenByParent = new Map<string, OrderItem[]>();
  for (const it of items) {
    if (it.parentOrderItemId) {
      const arr = childrenByParent.get(it.parentOrderItemId) ?? [];
      arr.push(it);
      childrenByParent.set(it.parentOrderItemId, arr);
    }
  }

  const mapModifiers = (item: OrderItem) =>
    item.modifiers?.map((m) => ({
      modifierId: m.modifierId,
      name: m.modifier?.name ?? '',
      priceAdjustment: Number(m.priceAdjustment),
      quantity: m.quantity,
    }));

  const result: CartItem[] = [];
  for (const item of items) {
    if (item.parentOrderItemId) continue; // combo child — folded into its parent
    const kids = childrenByParent.get(item.id) ?? [];
    if (kids.length > 0) {
      // Combo parent → one line at the combo effective unit price (children sum
      // / qty). comboSelections reconstructed from the children (best-effort;
      // the reopened combo is display/whole-pay only — edits are blocked).
      const comboTotal = kids.reduce((s, k) => s + Number(k.subtotal ?? 0), 0);
      const qty = item.quantity || 1;
      result.push({
        ...(item.product as Product),
        price: qty > 0 ? comboTotal / qty : comboTotal,
        quantity: qty,
        notes: item.notes || undefined,
        comboSelections: kids.map((k) => ({ groupId: '', componentProductId: k.productId })),
      });
    } else {
      // Standalone → use the CHARGED unit price (item.unitPrice), not the
      // catalog price, so a campaign item reopens at what was actually charged.
      result.push({
        ...(item.product as Product),
        price: Number(item.unitPrice ?? item.product?.price ?? 0),
        quantity: item.quantity,
        notes: item.notes || undefined,
        modifiers: mapModifiers(item),
      });
    }
  }
  // Stamp line identities (suffix-deduped) so loaded lines are targetable.
  return normalizeCartLines(result);
}
