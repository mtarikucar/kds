import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CartItem, Product, CartModifier } from '../types';

interface CartState {
  items: CartItem[];
  sessionId: string | null;
  tenantId: string | null;
  tableId: string | null;

  // Actions
  initializeSession: (tenantId: string, tableId: string | null) => void;
  setTableId: (tableId: string) => void;
  addItem: (product: Product, quantity: number, modifiers: CartModifier[], notes?: string) => void;
  updateItemQuantity: (itemId: string, quantity: number) => void;
  updateItemNotes: (itemId: string, notes: string) => void;
  removeItem: (itemId: string) => void;
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
    (set, get) => ({
      items: [],
      sessionId: null,
      tenantId: null,
      tableId: null,

      initializeSession: (tenantId: string, tableId: string | null) => {
        const currentSession = get().sessionId;
        const currentTenantId = get().tenantId;
        const currentTableId = get().tableId;

        // If changing tenant, clear cart and create new session
        if (currentTenantId !== tenantId) {
          set({
            sessionId: generateSessionId(),
            tenantId,
            tableId,
            items: [],
          });
        } else if (!currentSession) {
          // First time initialization
          set({
            sessionId: generateSessionId(),
            tenantId,
            tableId,
          });
        } else if (tableId && currentTableId !== tableId) {
          // Update tableId if provided and different (but keep cart items)
          set({ tableId });
        }
      },

      setTableId: (tableId: string) => {
        set({ tableId });
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
    }),
    {
      name: 'customer-cart-storage', // LocalStorage key
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        sessionId: state.sessionId,
        tenantId: state.tenantId,
        tableId: state.tableId,
      }),
    }
  )
);
