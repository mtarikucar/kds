import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartItem, Product, CartModifier } from '../types';

// deep-review FM3: dine-in turnover is fast, so the persisted customer cart
// self-expires well before the staff 12h window. A stale cart left on a shared
// QR kiosk/tablet must never rehydrate into the next guest's session.
const CART_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CartState {
  items: CartItem[];
  sessionId: string | null;
  tenantId: string | null;
  tableId: string | null;
  currency: string | null;
  // deep-review FM3: wall-clock timestamp of the last mutating write; used to
  // expire stale carts on rehydrate.
  savedAt: number | null;

  // Actions
  initializeSession: (
    tenantId: string,
    tableId: string | null,
    currency?: string,
    urlSessionId?: string | null
  ) => void;
  setTableId: (tableId: string) => void;
  setCurrency: (currency: string) => void;
  addItem: (product: Product, quantity: number, modifiers: CartModifier[], notes?: string) => void;
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

const generateSessionId = () => {
  return crypto.randomUUID();
};

const calculateItemTotal = (
  productPrice: number,
  modifiers: CartModifier[],
  quantity: number
): number => {
  const modifierTotal = modifiers.reduce(
    (sum, mod) => sum + (mod.priceAdjustment * mod.quantity),
    0
  );
  return (productPrice + modifierTotal) * quantity;
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

      initializeSession: (
        tenantId: string,
        tableId: string | null,
        currency?: string,
        urlSessionId?: string | null
      ) => {
        const currentSession = get().sessionId;
        const currentTenantId = get().tenantId;
        const currentTableId = get().tableId;

        // If changing tenant, clear cart and create new session
        if (currentTenantId !== tenantId) {
          set({
            sessionId: urlSessionId || generateSessionId(),
            tenantId,
            tableId,
            currency: currency || null,
            items: [],
          });
        } else if (!currentSession) {
          // First time initialization
          set({
            sessionId: urlSessionId || generateSessionId(),
            tenantId,
            tableId,
            currency: currency || null,
          });
        } else if (urlSessionId && urlSessionId !== currentSession) {
          // deep-review FM3: the kiosk/server issued a fresh per-guest session
          // id that differs from the stored one => new guest. Start a clean cart
          // even on a tenant-wide QR where tableId can't distinguish guests.
          set({
            sessionId: urlSessionId,
            tableId,
            items: [],
          });
        } else if (tableId && currentTableId !== tableId) {
          // deep-review FM3: a different table on the same device is a new guest
          // on a shared kiosk/tablet. Previously this preserved the cart, which
          // leaked the prior guest's items. Start a clean cart + new session.
          set({ sessionId: generateSessionId(), tableId, items: [] });
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

      setTableId: (tableId: string) => {
        set({ tableId });
      },

      setCurrency: (currency: string) => {
        set({ currency });
      },

      addItem: (product: Product, quantity: number, modifiers: CartModifier[], notes?: string) => {
        const items = get().items;

        // Check if identical item exists (same product, modifiers, and notes)
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

          return sameProduct && sameNotes && sameModifiers;
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
          // Add new item
          const newItem: CartItem = {
            id: crypto.randomUUID(),
            product,
            quantity,
            notes,
            modifiers,
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
      partialize: (state) => ({
        items: state.items,
        sessionId: state.sessionId,
        tenantId: state.tenantId,
        tableId: state.tableId,
        currency: state.currency,
        savedAt: state.savedAt,
      }),
      // deep-review FM3: expire stale carts on rehydrate so a previous guest's
      // items/session/table never surface to the next guest on a shared device.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.savedAt || Date.now() - state.savedAt > CART_TTL_MS) {
          state.items = [];
          state.sessionId = null;
          state.tableId = null;
        }
      },
    }
  )
);
