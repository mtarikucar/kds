import { OrderType, type CreateOrderDto, type Table } from '../../types';
import type { CartItem } from './posTypes';

/**
 * Build the create/update-order payload from current cart state.
 *
 * Extracted verbatim from POSPage where it was duplicated byte-for-byte
 * between handleCreateOrder and handleCheckout. Pure (apart from the
 * idempotency-key generator, which is injected so tests are deterministic).
 *
 * Behavior preserved exactly:
 *  - order type: TAKEAWAY when tableless-mode AND no selected table, else
 *    DINE_IN (matches `isTablelessMode && !selectedTable ? TAKEAWAY : DINE_IN`).
 *  - empty customerName / orderNotes coerce to undefined (omitted).
 *  - each item carries productId/quantity/notes plus a mapped modifiers array
 *    (modifierId + quantity). The cart item's optional modifiers map through.
 *  - idempotencyKey is a fresh per-click UUID — generated in the handler, NOT
 *    in render, so it is stable across an Axios 401-refresh retry of the same
 *    logical click. The generator is injectable for tests; defaults to
 *    crypto.randomUUID.
 */

/** Runtime shape of the payload — CreateOrderDto plus the modifiers the API also accepts. */
export type BuiltOrderData = CreateOrderDto & {
  items: Array<
    CreateOrderDto['items'][number] & {
      modifiers?: Array<{ modifierId: string; quantity: number }>;
    }
  >;
};

export interface BuildOrderDataArgs {
  isTablelessMode: boolean;
  selectedTable: Table | null;
  customerName: string;
  orderNotes: string;
  discount: number;
  cartItems: CartItem[];
  /** UUID generator — injected for deterministic tests. */
  generateId?: () => string;
}

export function buildOrderData({
  isTablelessMode,
  selectedTable,
  customerName,
  orderNotes,
  discount,
  cartItems,
  generateId = () => crypto.randomUUID(),
}: BuildOrderDataArgs): BuiltOrderData {
  // Determine order type based on mode
  const orderType =
    isTablelessMode && !selectedTable ? OrderType.TAKEAWAY : OrderType.DINE_IN;

  return {
    type: orderType,
    tableId: selectedTable?.id,
    customerName: customerName || undefined,
    notes: orderNotes || undefined,
    discount,
    items: cartItems.map((item) => ({
      productId: item.id,
      quantity: item.quantity,
      notes: item.notes,
      modifiers: item.modifiers?.map((m) => ({
        modifierId: m.modifierId,
        quantity: m.quantity,
      })),
    })),
    // Stable per-click idempotency key. Backend dedupes by
    // (tenantId, idempotencyKey) so a double-tap on a slow network
    // returns the existing order instead of creating a duplicate.
    idempotencyKey: generateId(),
  };
}
