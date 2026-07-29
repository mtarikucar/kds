import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore, SERVER_SESSION_ID_REGEX } from './cartStore';
import type { Product, CartModifier } from '../types';

const HEX64 = 'a'.repeat(64);

/**
 * Behavior guard for the customer POS cart — a money-adjacent store with zero
 * prior coverage. The load-bearing surface here is the line-total / subtotal
 * math: itemTotal = (product.price + sum(mod.priceAdjustment * mod.quantity))
 * * quantity. These tests drive the REAL store actions and read getState();
 * they never reimplement the arithmetic. Money assertions use exact numbers so
 * a float-precision regression (e.g. 0.1 + 0.2) would fail loudly.
 */

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-1',
    name: 'Burger',
    description: null,
    price: 10,
    image: null,
    categoryId: 'c-1',
    currentStock: 100,
    stockTracked: false,
    isAvailable: true,
    displayOrder: 0,
    tenantId: 't-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeModifier(overrides: Partial<CartModifier> = {}): CartModifier {
  return {
    id: 'm-1',
    name: 'extra-cheese',
    displayName: 'Extra Cheese',
    priceAdjustment: 1.5,
    quantity: 1,
    ...overrides,
  };
}

describe('cartStore', () => {
  beforeEach(() => {
    // Persisted store; jsdom localStorage is shared across tests.
    useCartStore.getState().clearCart();
    useCartStore.setState({
      sessionId: null,
      sessionExpiresAt: null,
      tenantId: null,
      tableId: null,
      currency: null,
    });
    localStorage.clear();
  });

  describe('addItem — new item line math', () => {
    it('computes itemTotal as price * quantity with no modifiers', () => {
      useCartStore.getState().addItem(makeProduct({ price: 10 }), 3, []);
      const items = useCartStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(3);
      expect(items[0].itemTotal).toBe(30);
    });

    it('adds modifier price adjustments before multiplying by quantity', () => {
      // (10 + 1.5*1 + 2*1) * 2 = 27
      const mods = [
        makeModifier({ id: 'm-1', priceAdjustment: 1.5, quantity: 1 }),
        makeModifier({ id: 'm-2', priceAdjustment: 2, quantity: 1 }),
      ];
      useCartStore.getState().addItem(makeProduct({ price: 10 }), 2, mods);
      expect(useCartStore.getState().items[0].itemTotal).toBe(27);
    });

    it('multiplies a modifier by its own quantity within the line', () => {
      // (10 + 1.5*3) * 2 = 29
      const mods = [makeModifier({ priceAdjustment: 1.5, quantity: 3 })];
      useCartStore.getState().addItem(makeProduct({ price: 10 }), 2, mods);
      expect(useCartStore.getState().items[0].itemTotal).toBe(29);
    });

    it('keeps fractional money exact (no 0.1+0.2 float drift)', () => {
      // (0.1 + 0.2) * 3 = 0.9 exactly, not 0.30000000000000004 * 3
      const mods = [makeModifier({ priceAdjustment: 0.2, quantity: 1 })];
      useCartStore.getState().addItem(makeProduct({ price: 0.1 }), 3, mods);
      expect(useCartStore.getState().items[0].itemTotal).toBeCloseTo(0.9, 10);
    });

    it('coerces a string price + string priceAdjustment (Prisma Decimal) instead of concatenating', () => {
      // price and priceAdjustment are TYPED number but the API serialises Prisma
      // Decimal as a STRING. Without Number() coercion, ("10" + 3) * 2 would
      // string-concatenate to "103" * 2 = 206 — a silent 8× overcharge shown to
      // the customer. Correct: (10 + 3) * 2 = 26.
      const mods = [makeModifier({ priceAdjustment: '3' as any, quantity: 1 })];
      useCartStore
        .getState()
        .addItem(makeProduct({ price: '10' as any }), 2, mods);
      expect(useCartStore.getState().items[0].itemTotal).toBe(26);
    });

    it('coerces a string price with NO modifiers (bare 0-append guard)', () => {
      // The nastiest case: "10" + 0 concatenates to "100" → * 3 = 300, a 10×
      // error, with no modifier needed to trigger it. Correct: 10 * 3 = 30.
      useCartStore.getState().addItem(makeProduct({ price: '10' as any }), 3, []);
      expect(useCartStore.getState().items[0].itemTotal).toBe(30);
    });

    it('stores notes on the new line', () => {
      useCartStore.getState().addItem(makeProduct(), 1, [], 'no onions');
      expect(useCartStore.getState().items[0].notes).toBe('no onions');
    });
  });

  describe('addItem — merge vs separate lines', () => {
    it('merges quantity into the existing line when product, modifiers and notes match', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ price: 10 }), 2, []);
      store.addItem(makeProduct({ price: 10 }), 3, []);
      const items = useCartStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(5);
      expect(items[0].itemTotal).toBe(50); // recomputed for merged qty
    });

    it('keeps a separate line when notes differ', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct(), 1, [], 'no onions');
      store.addItem(makeProduct(), 1, [], 'extra spicy');
      expect(useCartStore.getState().items).toHaveLength(2);
    });

    it('keeps a separate line when modifiers differ', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct(), 1, [makeModifier({ id: 'm-1' })]);
      store.addItem(makeProduct(), 1, [makeModifier({ id: 'm-2' })]);
      expect(useCartStore.getState().items).toHaveLength(2);
    });

    it('keeps a separate line when only the modifier quantity differs', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct(), 1, [makeModifier({ id: 'm-1', quantity: 1 })]);
      store.addItem(makeProduct(), 1, [makeModifier({ id: 'm-1', quantity: 2 })]);
      expect(useCartStore.getState().items).toHaveLength(2);
    });

    it('keeps a separate line for a different product', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1' }), 1, []);
      store.addItem(makeProduct({ id: 'p-2' }), 1, []);
      expect(useCartStore.getState().items).toHaveLength(2);
    });

    it('merges identical modifier+notes lines and recomputes the total', () => {
      const store = useCartStore.getState();
      const mods = () => [makeModifier({ priceAdjustment: 1.5, quantity: 1 })];
      store.addItem(makeProduct({ price: 10 }), 1, mods(), 'rare');
      store.addItem(makeProduct({ price: 10 }), 2, mods(), 'rare');
      const items = useCartStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe(3);
      expect(items[0].itemTotal).toBe(34.5); // (10 + 1.5) * 3
    });
  });

  describe('updateItemQuantity', () => {
    it('sets the new quantity and recomputes itemTotal including modifiers', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ price: 10 }), 1, [makeModifier({ priceAdjustment: 2, quantity: 1 })]);
      const id = useCartStore.getState().items[0].id;
      store.updateItemQuantity(id, 4);
      const item = useCartStore.getState().items[0];
      expect(item.quantity).toBe(4);
      expect(item.itemTotal).toBe(48); // (10 + 2) * 4
    });

    it('removes the line when quantity drops to zero', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct(), 1, []);
      const id = useCartStore.getState().items[0].id;
      store.updateItemQuantity(id, 0);
      expect(useCartStore.getState().items).toHaveLength(0);
    });

    it('removes the line when quantity goes negative', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct(), 1, []);
      const id = useCartStore.getState().items[0].id;
      store.updateItemQuantity(id, -2);
      expect(useCartStore.getState().items).toHaveLength(0);
    });

    it('leaves other lines untouched', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1', price: 10 }), 1, []);
      store.addItem(makeProduct({ id: 'p-2', price: 5 }), 1, []);
      const firstId = useCartStore.getState().items[0].id;
      store.updateItemQuantity(firstId, 2);
      const items = useCartStore.getState().items;
      expect(items[0].itemTotal).toBe(20);
      expect(items[1].itemTotal).toBe(5);
    });
  });

  describe('updateItemNotes', () => {
    it('updates the notes on the targeted line', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct(), 1, [], 'old');
      const id = useCartStore.getState().items[0].id;
      store.updateItemNotes(id, 'new note');
      expect(useCartStore.getState().items[0].notes).toBe('new note');
    });
  });

  describe('removeItem', () => {
    it('removes only the targeted line', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1' }), 1, []);
      store.addItem(makeProduct({ id: 'p-2' }), 1, []);
      const firstId = useCartStore.getState().items[0].id;
      store.removeItem(firstId);
      const items = useCartStore.getState().items;
      expect(items).toHaveLength(1);
      expect(items[0].product.id).toBe('p-2');
    });
  });

  describe('clearCart', () => {
    it('empties all lines', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1' }), 1, []);
      store.addItem(makeProduct({ id: 'p-2' }), 2, []);
      store.clearCart();
      expect(useCartStore.getState().items).toHaveLength(0);
    });
  });

  describe('reorderItems', () => {
    it('moves the active line to the over line position', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1' }), 1, []);
      store.addItem(makeProduct({ id: 'p-2' }), 1, []);
      store.addItem(makeProduct({ id: 'p-3' }), 1, []);
      const [a, , c] = useCartStore.getState().items;
      store.reorderItems(a.id, c.id); // move p-1 to where p-3 is
      const order = useCartStore.getState().items.map((i) => i.product.id);
      expect(order).toEqual(['p-2', 'p-3', 'p-1']);
    });

    it('is a no-op when an id is unknown', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1' }), 1, []);
      store.addItem(makeProduct({ id: 'p-2' }), 1, []);
      const before = useCartStore.getState().items.map((i) => i.product.id);
      store.reorderItems('does-not-exist', useCartStore.getState().items[0].id);
      expect(useCartStore.getState().items.map((i) => i.product.id)).toEqual(before);
    });
  });

  describe('computed totals', () => {
    it('returns zeros on an empty cart', () => {
      const store = useCartStore.getState();
      expect(store.getItemCount()).toBe(0);
      expect(store.getSubtotal()).toBe(0);
      expect(store.getTotal()).toBe(0);
    });

    it('getItemCount sums the quantities across lines', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ id: 'p-1' }), 2, []);
      store.addItem(makeProduct({ id: 'p-2' }), 3, []);
      expect(useCartStore.getState().getItemCount()).toBe(5);
    });

    it('getSubtotal sums line totals across mixed lines with modifiers and qty>1', () => {
      const store = useCartStore.getState();
      // line A: (10 + 1.5*2) * 2 = 26
      store.addItem(makeProduct({ id: 'p-1', price: 10 }), 2, [
        makeModifier({ id: 'm-1', priceAdjustment: 1.5, quantity: 2 }),
      ]);
      // line B: 5 * 3 = 15
      store.addItem(makeProduct({ id: 'p-2', price: 5 }), 3, []);
      expect(useCartStore.getState().getSubtotal()).toBe(41);
    });

    it('getTotal currently equals getSubtotal (no tax/service yet)', () => {
      const store = useCartStore.getState();
      store.addItem(makeProduct({ price: 10 }), 2, []);
      const s = useCartStore.getState();
      expect(s.getTotal()).toBe(s.getSubtotal());
      expect(s.getTotal()).toBe(20);
    });
  });

  describe('initializeSession — cart isolation', () => {
    it('binds tenant/table/currency on first init WITHOUT fabricating a session (C1)', () => {
      useCartStore.getState().initializeSession('t-1', 'table-1', 'USD');
      const s = useCartStore.getState();
      // Review C1: the ONLY valid session is server-minted; the store must
      // never invent a local id (the old crypto.randomUUID() one was rejected
      // by every backend DTO).
      expect(s.sessionId).toBeNull();
      expect(s.tenantId).toBe('t-1');
      expect(s.tableId).toBe('table-1');
      expect(s.currency).toBe('USD');
    });

    it('wipes the cart and drops the session when switching to a different tenant', () => {
      const store = useCartStore.getState();
      store.initializeSession('t-1', 'table-1');
      store.setServerSession(HEX64, null);
      store.addItem(makeProduct(), 1, []);
      store.initializeSession('t-2', 'table-9');
      const s = useCartStore.getState();
      expect(s.tenantId).toBe('t-2');
      expect(s.items).toHaveLength(0);
      expect(s.sessionId).toBeNull();
      expect(s.sessionExpiresAt).toBeNull();
    });

    it('keeps the cart AND the server session when re-initializing the same tenant', () => {
      const store = useCartStore.getState();
      store.initializeSession('t-1', 'table-1');
      store.setServerSession(HEX64, null);
      store.addItem(makeProduct(), 2, []);
      store.initializeSession('t-1', 'table-1');
      expect(useCartStore.getState().items).toHaveLength(1);
      expect(useCartStore.getState().items[0].quantity).toBe(2);
      expect(useCartStore.getState().sessionId).toBe(HEX64);
    });

    it('clears tableId for a tenant-wide QR (null tableId) while keeping the cart', () => {
      const store = useCartStore.getState();
      store.initializeSession('t-1', 'table-1');
      store.addItem(makeProduct(), 1, []);
      store.initializeSession('t-1', null);
      const s = useCartStore.getState();
      expect(s.tableId).toBeNull();
      expect(s.items).toHaveLength(1);
    });

    // deep-review FM3: a different table on the same shared device is a new
    // guest — the previous guest's cart must NOT leak across.
    it('wipes the cart and drops the session when the table changes', () => {
      const store = useCartStore.getState();
      store.initializeSession('t-1', 'table-1');
      store.setServerSession(HEX64, null);
      store.addItem(makeProduct(), 1, []);
      store.initializeSession('t-1', 'table-2');
      const s = useCartStore.getState();
      expect(s.tableId).toBe('table-2');
      expect(s.items).toHaveLength(0);
      expect(s.sessionId).toBeNull();
    });
  });

  // Review C1: the session identity is server-minted and shape-guarded.
  describe('server session (C1)', () => {
    it('setServerSession stores a 64-hex token with its expiry', () => {
      const expires = new Date(Date.now() + 3_600_000);
      useCartStore.getState().setServerSession(HEX64, expires.toISOString());
      const s = useCartStore.getState();
      expect(s.sessionId).toBe(HEX64);
      expect(s.sessionExpiresAt).toBe(expires.getTime());
    });

    it('setServerSession REFUSES a non-server-shaped id (UUID can never come back)', () => {
      useCartStore
        .getState()
        .setServerSession('0198c7a2-1111-4222-8333-444455556666', null);
      expect(useCartStore.getState().sessionId).toBeNull();
    });

    it('clearServerSession drops id + expiry', () => {
      useCartStore.getState().setServerSession(HEX64, null);
      useCartStore.getState().clearServerSession();
      const s = useCartStore.getState();
      expect(s.sessionId).toBeNull();
      expect(s.sessionExpiresAt).toBeNull();
    });

    it('persist migration discards a legacy locally-fabricated UUID session', async () => {
      // Simulate the pre-C1 persisted shape (version 0: no version field,
      // sessionId = crypto.randomUUID()). Rehydrating must DISCARD the UUID
      // so a real server session gets minted instead of 400/401-ing forever.
      localStorage.setItem(
        'customer-cart-storage',
        JSON.stringify({
          state: {
            items: [],
            sessionId: '0198c7a2-1111-4222-8333-444455556666',
            tenantId: 't-1',
            tableId: 'table-1',
            currency: 'TRY',
            savedAt: Date.now(),
          },
        }),
      );
      await useCartStore.persist.rehydrate();
      const s = useCartStore.getState();
      expect(s.sessionId).toBeNull();
      expect(s.tenantId).toBe('t-1'); // binding survives, identity does not
    });

    it('persist migration keeps a valid server-minted 64-hex session', async () => {
      localStorage.setItem(
        'customer-cart-storage',
        JSON.stringify({
          state: {
            items: [],
            sessionId: HEX64,
            sessionExpiresAt: Date.now() + 3_600_000,
            tenantId: 't-1',
            tableId: null,
            currency: 'TRY',
            savedAt: Date.now(),
          },
          version: 1,
        }),
      );
      await useCartStore.persist.rehydrate();
      expect(useCartStore.getState().sessionId).toBe(HEX64);
      expect(SERVER_SESSION_ID_REGEX.test(useCartStore.getState().sessionId!)).toBe(
        true,
      );
    });
  });

  // deep-review FM3: stamp savedAt on mutating writes so the persisted cart can
  // self-expire on rehydrate.
  describe('cart freshness (TTL)', () => {
    it('stamps savedAt when items are added', () => {
      const before = Date.now();
      useCartStore.getState().addItem(makeProduct(), 1, []);
      const savedAt = useCartStore.getState().savedAt;
      expect(savedAt).toBeTruthy();
      expect(savedAt as number).toBeGreaterThanOrEqual(before);
    });
  });
});
