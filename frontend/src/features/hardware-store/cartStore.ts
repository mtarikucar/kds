import { create } from 'zustand';
import type { CartItem, HardwareProduct } from './storeApi';

/**
 * v2.8.87 — shared hardware-cart store.
 *
 * Pre-v2.8.87 the cart lived in StorePage's local React state — fine
 * while everything happened on one page, but adding the detail route
 * (/admin/store/:sku) meant a buyer who clicked into a detail page lost
 * their cart on the way back to the list. Moving it to a Zustand store
 * means list + detail + checkout modal all read the same source of
 * truth.
 *
 * In-memory only (no persist middleware): a refresh empties the cart
 * deliberately so we don't ship orders the buyer abandoned weeks ago.
 *
 * Cart line shapes:
 *   - hardware:  { product, qty, acquisition: 'sell'|'rent' }
 *   - service:   { product, qty, branchId, preferredDates[], notes }
 * Plan + add-on lines are not yet wired into the SPA cart UI — they
 * flow through CheckoutController.intent at /v1/checkout via a separate
 * upsell path. When that lands (v2.9.x), extend the union here.
 */

export interface HardwareCartLine {
  type: 'hardware';
  product: HardwareProduct;
  qty: number;
  acquisition: 'sell' | 'rent';
}

export interface ServiceCartLine {
  type: 'service';
  product: HardwareProduct;
  qty: number;
  branchId?: string;
  preferredDates?: string[]; // ISO YYYY-MM-DD
  notes?: string;
}

export type CartLine = HardwareCartLine | ServiceCartLine;

interface CartState {
  lines: CartLine[];
  addHardware: (product: HardwareProduct, opts?: { qty?: number; acquisition?: 'sell' | 'rent' }) => void;
  addService: (
    product: HardwareProduct,
    opts: { branchId?: string; preferredDates?: string[]; notes?: string },
  ) => void;
  // Operate on the LINE key (see cartLineKey), NOT the bare productId: the
  // same product can legitimately sit in the cart as two lines (sell + rent,
  // or a service scheduled for two branches). Keying setQty/remove on
  // productId alone silently mutated/removed BOTH lines — breaking the very
  // distinct-line contract addHardware/addService establish.
  setQty: (lineKey: string, qty: number) => void;
  remove: (lineKey: string) => void;
  clear: () => void;
}

/**
 * Stable unique identity for a cart line — mirrors the dedup keys used by
 * addHardware (productId + acquisition) and addService (productId + branchId).
 * setQty/remove target THIS, so a sell line and a rent line of the same product
 * (or the same service at two branches) can be managed independently.
 */
export function cartLineKey(l: CartLine): string {
  return l.type === 'hardware'
    ? `hw:${l.product.id}:${l.acquisition}`
    : `sv:${l.product.id}:${(l as ServiceCartLine).branchId ?? ''}`;
}

export const useCartStore = create<CartState>((set) => ({
  lines: [],

  addHardware: (product, opts) =>
    set((state) => {
      const qty = opts?.qty ?? 1;
      const acquisition = opts?.acquisition ?? 'sell';
      const idx = state.lines.findIndex(
        (l) => l.type === 'hardware' && l.product.id === product.id && l.acquisition === acquisition,
      );
      if (idx >= 0) {
        const next = [...state.lines];
        const existing = next[idx] as HardwareCartLine;
        next[idx] = { ...existing, qty: existing.qty + qty };
        return { lines: next };
      }
      return {
        lines: [
          ...state.lines,
          { type: 'hardware', product, qty, acquisition } satisfies HardwareCartLine,
        ],
      };
    }),

  addService: (product, opts) =>
    set((state) => {
      // Services key on (productId, branchId) — same service for
      // different branches is two separate lines so a tenant can
      // schedule independent installs in one checkout.
      const idx = state.lines.findIndex(
        (l) =>
          l.type === 'service' &&
          l.product.id === product.id &&
          (l as ServiceCartLine).branchId === opts.branchId,
      );
      if (idx >= 0) {
        // Service quantities don't compose (same install, twice?) —
        // re-adding overwrites the preferred-dates / notes with the
        // latest input.
        const next = [...state.lines];
        next[idx] = {
          ...(next[idx] as ServiceCartLine),
          preferredDates: opts.preferredDates,
          notes: opts.notes,
        };
        return { lines: next };
      }
      return {
        lines: [
          ...state.lines,
          {
            type: 'service',
            product,
            qty: 1,
            branchId: opts.branchId,
            preferredDates: opts.preferredDates,
            notes: opts.notes,
          } satisfies ServiceCartLine,
        ],
      };
    }),

  setQty: (lineKey, qty) =>
    set((state) => ({
      lines: state.lines.map((l) =>
        cartLineKey(l) === lineKey
          ? l.type === 'service'
            ? l // services don't compose
            : { ...l, qty: Math.max(1, qty) }
          : l,
      ),
    })),

  remove: (lineKey) =>
    set((state) => ({
      lines: state.lines.filter((l) => cartLineKey(l) !== lineKey),
    })),

  clear: () => set({ lines: [] }),
}));

/**
 * Project the Zustand cart lines down to the wire-format `CartItem[]`
 * that the quote / intent endpoints consume. Kept here (not on the
 * store) so the projection is stable across consumers.
 */
export function toCartItems(lines: CartLine[]): CartItem[] {
  return lines.map((l): CartItem => {
    if (l.type === 'hardware') {
      return {
        type: 'hardware',
        sku: l.product.sku,
        qty: l.qty,
        acquisition: l.acquisition,
      };
    }
    return {
      type: 'service',
      code: l.product.sku,
      qty: l.qty,
      branchId: l.branchId,
      // The DTO layer accepts these via the v2.8.87 cart.dto extension.
      preferredDates: l.preferredDates,
      notes: l.notes,
    } as CartItem;
  });
}
