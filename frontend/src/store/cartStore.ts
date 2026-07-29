import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartItem, Product, CartModifier, ComboSelectionInput } from '../types';

// Stable string key for a combo's component picks so two combos with different
// selections never merge into one cart line.
const comboKey = (sel?: ComboSelectionInput[]): string =>
  (sel ?? [])
    .map((s) => `${s.groupId}:${s.componentProductId}`)
    .sort()
    .join('|');

// deep-review FM3: dine-in turnover is fast, so the persisted customer cart
// self-expires well before the staff 12h window. A stale cart left on a shared
// QR kiosk/tablet must never rehydrate into the next guest's session.
const CART_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// Review C1: the ONLY valid customer session identity is a SERVER-MINTED
// token — 32 random bytes hex-encoded = exactly 64 lower-hex chars, minted by
// POST /customer-public/sessions and backed by a CustomerSession row. The
// store used to fabricate a crypto.randomUUID() here, which every backend DTO
// (/^[0-9a-f]{64}$/) rejected — orders 400'd, tracking/self-pay/loyalty 401'd.
// The store no longer generates ANY local id: sessionId is either a
// server-minted token or null (features/qr-menu/customerSession.ts mints it).
export const SERVER_SESSION_ID_REGEX = /^[0-9a-f]{64}$/;

interface CartState {
  items: CartItem[];
  sessionId: string | null;
  tenantId: string | null;
  tableId: string | null;
  currency: string | null;
  // deep-review FM3: wall-clock timestamp of the last mutating write; used to
  // expire stale carts on rehydrate.
  savedAt: number | null;
  // Review C1: server-reported expiry (epoch ms) of the minted session, so
  // ensureCustomerSession can re-mint proactively instead of eating a 401.
  sessionExpiresAt: number | null;

  // Actions
  initializeSession: (
    tenantId: string,
    tableId: string | null,
    currency?: string
  ) => void;
  // Review C1: store the server-minted session (customerSession.ts only).
  setServerSession: (sessionId: string, expiresAt: string | Date | null) => void;
  clearServerSession: () => void;
  setTableId: (tableId: string) => void;
  setCurrency: (currency: string) => void;
  addItem: (
    product: Product,
    quantity: number,
    modifiers: CartModifier[],
    notes?: string,
    comboSelections?: ComboSelectionInput[],
  ) => void;
  updateItemQuantity: (itemId: string, quantity: number) => void;
  updateItemNotes: (itemId: string, notes: string) => void;
  removeItem: (itemId: string) => void;
  reorderItems: (activeId: string, overId: string) => void;
  clearCart: () => void;

  // Computed values
  getItemCount: () => number;
  getSubtotal: () => number;
  getTotal: () => number;
}

const calculateItemTotal = (
  productPrice: number,
  modifiers: CartModifier[],
  quantity: number
): number => {
  // Coerce through Number() before any `+`. product.price and priceAdjustment
  // are TYPED `number` but arrive from the API as Prisma Decimal, which
  // serializes to a STRING. menu-query.service already coerces the customer-menu
  // path, but a string reaching here from any other product source (partner
  // display API, a persisted pre-coercion cart) would make `productPrice + …`
  // CONCATENATE ("50" + 0 → "500") and silently 10× the line total. This
  // mirrors the POS posCart.ts `Number(item.price)` defence so the two carts
  // can never drift on price arithmetic.
  const modifierTotal = modifiers.reduce(
    (sum, mod) => sum + Number(mod.priceAdjustment) * mod.quantity,
    0
  );
  return (Number(productPrice) + modifierTotal) * quantity;
};

export const useCartStore = create<CartState>()(
  persist(
    (rawSet, get) => {
      // deep-review FM3: every mutating write stamps savedAt so the persisted
      // cart can self-expire on rehydrate. Wrap set instead of touching every
      // call site.
      const set: typeof rawSet = ((partial: unknown, replace?: boolean) => {
        if (typeof partial === 'function') {
          return (rawSet as (p: unknown, r?: boolean) => void)(
            (state: CartState) => ({
              ...(partial as (s: CartState) => Partial<CartState>)(state),
              savedAt: Date.now(),
            }),
            replace as never
          );
        }
        return (rawSet as (p: unknown, r?: boolean) => void)(
          { ...(partial as Partial<CartState>), savedAt: Date.now() },
          replace as never
        );
      }) as typeof rawSet;

      return {
      items: [],
      sessionId: null,
      tenantId: null,
      tableId: null,
      currency: null,
      savedAt: null,
      sessionExpiresAt: null,

      // Review C1 + FH5: this action NEVER creates a session id. It only binds
      // the cart to a tenant/table and invalidates the stored server session
      // when the guest context changes; customerSession.ts mints the real
      // 64-hex token from the server afterwards. A sessionId is NEVER read
      // from the URL — it is a bearer credential (FH5).
      initializeSession: (
        tenantId: string,
        tableId: string | null,
        currency?: string
      ) => {
        const currentTenantId = get().tenantId;
        const currentTableId = get().tableId;

        if (currentTenantId !== tenantId) {
          // Different tenant → new guest context: clear the cart and drop the
          // old tenant's session (it would be rejected server-side anyway).
          set({
            sessionId: null,
            sessionExpiresAt: null,
            tenantId,
            tableId,
            currency: currency || null,
            items: [],
          });
        } else if (tableId && currentTableId !== tableId) {
          // deep-review FM3: a different table on the same device is a new
          // guest on a shared kiosk/tablet. Start a clean cart and drop the
          // session so a fresh one is minted for the new table. (Same-guest
          // in-app table picks go through setTableId, which keeps both.)
          set({ sessionId: null, sessionExpiresAt: null, tableId, items: [] });
        } else if (tableId === null && currentTableId !== null) {
          // Clear tableId when using tenant-wide QR (no tableId in URL)
          // This ensures table selection modal appears for general QR codes
          set({ tableId: null });
        }
        // Update currency if provided
        if (currency) {
          set({ currency });
        }
      },

      setServerSession: (sessionId: string, expiresAt: string | Date | null) => {
        // Defensive: refuse to store anything that is not a server-shaped
        // token, so a non-hex value can never become the device identity.
        if (!SERVER_SESSION_ID_REGEX.test(sessionId)) return;
        set({
          sessionId,
          sessionExpiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
        });
      },

      clearServerSession: () => {
        set({ sessionId: null, sessionExpiresAt: null });
      },

      setTableId: (tableId: string) => {
        set({ tableId });
      },

      setCurrency: (currency: string) => {
        set({ currency });
      },

      addItem: (
        product: Product,
        quantity: number,
        modifiers: CartModifier[],
        notes?: string,
        comboSelections?: ComboSelectionInput[],
      ) => {
        const items = get().items;
        const key = comboKey(comboSelections);

        // Check if identical item exists (same product, modifiers, notes AND
        // combo selections — combos with different picks stay separate lines).
        const existingItemIndex = items.findIndex(item => {
          const sameProduct = item.product.id === product.id;
          const sameNotes = (item.notes || '') === (notes || '');
          const sameModifiers =
            item.modifiers.length === modifiers.length &&
            item.modifiers.every((mod, idx) => {
              const matchingMod = modifiers[idx];
              return matchingMod &&
                mod.id === matchingMod.id &&
                mod.quantity === matchingMod.quantity;
            });
          const sameCombo = comboKey(item.comboSelections) === key;

          return sameProduct && sameNotes && sameModifiers && sameCombo;
        });

        if (existingItemIndex !== -1) {
          // Update existing item quantity
          const updatedItems = [...items];
          const existingItem = updatedItems[existingItemIndex];
          const newQuantity = existingItem.quantity + quantity;

          updatedItems[existingItemIndex] = {
            ...existingItem,
            quantity: newQuantity,
            itemTotal: calculateItemTotal(product.price, modifiers, newQuantity),
          };

          set({ items: updatedItems });
        } else {
          // Add new item. For a COMBO the caller passes a product copy whose
          // `price` already includes the chosen slot priceDeltas, so the shared
          // total math needs no combo special-case.
          const newItem: CartItem = {
            id: crypto.randomUUID(),
            product,
            quantity,
            notes,
            modifiers,
            comboSelections,
            itemTotal: calculateItemTotal(product.price, modifiers, quantity),
          };

          set({ items: [...items, newItem] });
        }
      },

      updateItemQuantity: (itemId: string, quantity: number) => {
        if (quantity <= 0) {
          get().removeItem(itemId);
          return;
        }

        const items = get().items;
        const updatedItems = items.map(item => {
          if (item.id === itemId) {
            return {
              ...item,
              quantity,
              itemTotal: calculateItemTotal(item.product.price, item.modifiers, quantity),
            };
          }
          return item;
        });

        set({ items: updatedItems });
      },

      updateItemNotes: (itemId: string, notes: string) => {
        const items = get().items;
        const updatedItems = items.map(item => {
          if (item.id === itemId) {
            return { ...item, notes };
          }
          return item;
        });

        set({ items: updatedItems });
      },

      removeItem: (itemId: string) => {
        const items = get().items;
        set({ items: items.filter(item => item.id !== itemId) });
      },

      reorderItems: (activeId: string, overId: string) => {
        const items = get().items;
        const oldIndex = items.findIndex(item => item.id === activeId);
        const newIndex = items.findIndex(item => item.id === overId);

        if (oldIndex === -1 || newIndex === -1) return;

        const reorderedItems = [...items];
        const [movedItem] = reorderedItems.splice(oldIndex, 1);
        reorderedItems.splice(newIndex, 0, movedItem);

        set({ items: reorderedItems });
      },

      clearCart: () => {
        set({ items: [] });
      },

      getItemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0);
      },

      getSubtotal: () => {
        return get().items.reduce((sum, item) => sum + item.itemTotal, 0);
      },

      getTotal: () => {
        // For now, total = subtotal. Tax/service charges can be added later
        return get().getSubtotal();
      },
      };
    },
    {
      name: 'customer-cart-storage', // LocalStorage key
      storage: createJSONStorage(() => localStorage),
      // Review C1: v1 marks the switch to server-minted 64-hex sessions. Any
      // pre-v1 persisted state carries a locally fabricated UUID sessionId
      // that the backend rejects — migrate discards it so a real session is
      // minted on load instead of every call 400/401-ing forever.
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Partial<CartState> | undefined;
        if (
          state &&
          (!state.sessionId || !SERVER_SESSION_ID_REGEX.test(state.sessionId))
        ) {
          state.sessionId = null;
          state.sessionExpiresAt = null;
        }
        return state as CartState;
      },
      partialize: (state) => ({
        items: state.items,
        sessionId: state.sessionId,
        tenantId: state.tenantId,
        tableId: state.tableId,
        currency: state.currency,
        savedAt: state.savedAt,
        sessionExpiresAt: state.sessionExpiresAt,
      }),
      // deep-review FM3: expire stale carts on rehydrate so a previous guest's
      // items/session/table never surface to the next guest on a shared device.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.savedAt || Date.now() - state.savedAt > CART_TTL_MS) {
          state.items = [];
          state.sessionId = null;
          state.sessionExpiresAt = null;
          state.tableId = null;
        }
        // Review C1 belt-and-braces: never rehydrate a non-server-shaped
        // session id (e.g. a same-version write that predates a hotfix).
        if (state.sessionId && !SERVER_SESSION_ID_REGEX.test(state.sessionId)) {
          state.sessionId = null;
          state.sessionExpiresAt = null;
        }
      },
    }
  )
);
