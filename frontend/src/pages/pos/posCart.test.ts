import { describe, it, expect } from 'vitest';
import {
  calculateItemTotal,
  calculateSubtotal,
  calculateTotal,
  computeChangeDue,
  isTenderSufficient,
  canProceedToPayment,
  paymentBlockedReason,
  resolvePaymentTarget,
  hasRemainingUnpaidOrders,
  mapOrderItemsToCart,
  mergeCartItem,
  type PosCartItem,
} from './posCart';
import type { CartItem } from './posTypes';
import { OrderType, OrderStatus, type Order, type OrderItem, type Product, type OrderItemModifier, type Modifier } from '../../types';
import type { SelectedModifier } from '../../components/pos/ProductOptionsModal';
import { buildOrderData } from './buildOrderData';

const mod = (priceAdjustment: number, quantity = 1): SelectedModifier =>
  ({ modifierId: `m-${priceAdjustment}-${quantity}`, priceAdjustment, quantity } as SelectedModifier);

describe('posCart money math', () => {
  describe('calculateItemTotal', () => {
    it('multiplies base price by quantity with no modifiers', () => {
      expect(calculateItemTotal(10, [], 3)).toBe(30);
    });

    it('adds modifier price adjustments (each scaled by its own quantity) before line quantity', () => {
      // (12 base + (2*1 + 1.5*2)) * 2 = (12 + 5) * 2 = 34
      expect(calculateItemTotal(12, [mod(2, 1), mod(1.5, 2)], 2)).toBe(34);
    });

    it('matches the cartStore arithmetic exactly: (price + Σmod) * qty', () => {
      const price = 8.25;
      const mods = [mod(0.75, 2), mod(1.0, 1)];
      const qty = 4;
      const expected = (price + (0.75 * 2 + 1.0 * 1)) * qty;
      expect(calculateItemTotal(price, mods, qty)).toBe(expected);
    });

    it('handles negative modifier adjustments (e.g. a discount modifier)', () => {
      expect(calculateItemTotal(10, [mod(-2, 1)], 1)).toBe(8);
    });
  });

  describe('calculateSubtotal', () => {
    it('sums all lines including modifiers', () => {
      const items: PosCartItem[] = [
        { price: 10, quantity: 2, modifiers: [] }, // 20
        { price: 5, quantity: 1, modifiers: [mod(1, 1)] }, // 6
      ];
      expect(calculateSubtotal(items)).toBe(26);
    });

    it('coerces string prices from the API (decimal columns serialize as strings)', () => {
      const items: PosCartItem[] = [{ price: '12.50', quantity: 2 }];
      expect(calculateSubtotal(items)).toBe(25);
    });

    it('treats a missing modifiers array as no modifiers', () => {
      const items: PosCartItem[] = [{ price: 7, quantity: 3 }];
      expect(calculateSubtotal(items)).toBe(21);
    });

    it('returns 0 for an empty cart', () => {
      expect(calculateSubtotal([])).toBe(0);
    });
  });

  describe('calculateTotal', () => {
    it('subtracts a flat discount from the subtotal', () => {
      const items: PosCartItem[] = [{ price: 10, quantity: 5 }]; // 50
      expect(calculateTotal(items, 8)).toBe(42);
    });

    it('equals subtotal when discount is 0', () => {
      const items: PosCartItem[] = [{ price: 3, quantity: 4 }];
      expect(calculateTotal(items, 0)).toBe(calculateSubtotal(items));
    });
  });

  describe('computeChangeDue', () => {
    it('returns 0 for an exact payment', () => {
      expect(computeChangeDue(100, 100)).toBe(0);
    });

    it('returns the difference when over-paying', () => {
      expect(computeChangeDue(73, 100)).toBe(27);
    });

    it('never returns a negative when under-paying', () => {
      expect(computeChangeDue(100, 60)).toBe(0);
    });

    it('returns 0 when both total and tender are 0', () => {
      expect(computeChangeDue(0, 0)).toBe(0);
    });

    it('handles decimal amounts and rounds to 2 places (no float noise)', () => {
      // 100.30 - 100.10 = 0.2 but float subtraction yields 0.1999999...
      expect(computeChangeDue(100.1, 100.3)).toBe(0.2);
      expect(computeChangeDue(12.55, 20)).toBe(7.45);
    });
  });

  describe('isTenderSufficient', () => {
    it('is true for an exact payment', () => {
      expect(isTenderSufficient(50, 50)).toBe(true);
    });

    it('is true when over-paying', () => {
      expect(isTenderSufficient(50, 100)).toBe(true);
    });

    it('is false when under-paying', () => {
      expect(isTenderSufficient(50, 49.99)).toBe(false);
    });

    it('is true at zero total with zero tender', () => {
      expect(isTenderSufficient(0, 0)).toBe(true);
    });

    it('treats an exact payment as sufficient even when the total carries float noise', () => {
      // The order total is a client-summed float, so 0.1 + 0.2 lands on
      // 0.30000000000000004. Tendering exactly 0.30 must NOT be rejected —
      // computeChangeDue already treats this pair as fully covered (change 0),
      // and a raw `tendered >= total` would drift from that and block confirm.
      const noisyTotal = 0.1 + 0.2;
      expect(noisyTotal).not.toBe(0.3); // sanity: the noise is real
      expect(isTenderSufficient(noisyTotal, 0.3)).toBe(true);
      expect(computeChangeDue(noisyTotal, 0.3)).toBe(0);
    });
  });
});

/** Build a minimal Order with just the fields the gate reads. */
const order = (type: OrderType | undefined, status: OrderStatus): Order =>
  ({ id: 'o-1', type, status } as Order);

describe('posCart payment eligibility gate', () => {
  describe('canProceedToPayment', () => {
    it('blocks when there is no active order id', () => {
      expect(
        canProceedToPayment({
          currentOrderId: null,
          currentOrder: order(OrderType.DINE_IN, OrderStatus.PENDING),
          requireServedForDineInPayment: false,
        }),
      ).toBe(false);
    });

    it('blocks when the order object is missing even with an id', () => {
      expect(
        canProceedToPayment({
          currentOrderId: 'o-1',
          currentOrder: null,
          requireServedForDineInPayment: false,
        }),
      ).toBe(false);
    });

    it('always allows TAKEAWAY regardless of status or the dine-in setting', () => {
      expect(
        canProceedToPayment({
          currentOrderId: 'o-1',
          currentOrder: order(OrderType.TAKEAWAY, OrderStatus.PENDING),
          requireServedForDineInPayment: true,
        }),
      ).toBe(true);
    });

    it('always allows DELIVERY regardless of status or the dine-in setting', () => {
      expect(
        canProceedToPayment({
          currentOrderId: 'o-1',
          currentOrder: order(OrderType.DELIVERY, OrderStatus.PREPARING),
          requireServedForDineInPayment: true,
        }),
      ).toBe(true);
    });

    it('defaults a missing order type to DINE_IN (gated by the setting)', () => {
      expect(
        canProceedToPayment({
          currentOrderId: 'o-1',
          currentOrder: order(undefined, OrderStatus.PENDING),
          requireServedForDineInPayment: true,
        }),
      ).toBe(false);
    });

    describe('DINE_IN with requireServedForDineInPayment ON', () => {
      it.each([
        [OrderStatus.SERVED, true],
        [OrderStatus.READY, true],
        [OrderStatus.PENDING, false],
        [OrderStatus.PREPARING, false],
      ])('status %s -> %s', (status, expected) => {
        expect(
          canProceedToPayment({
            currentOrderId: 'o-1',
            currentOrder: order(OrderType.DINE_IN, status),
            requireServedForDineInPayment: true,
          }),
        ).toBe(expected);
      });
    });

    it('DINE_IN with setting OFF allows payment at any status', () => {
      expect(
        canProceedToPayment({
          currentOrderId: 'o-1',
          currentOrder: order(OrderType.DINE_IN, OrderStatus.PENDING),
          requireServedForDineInPayment: false,
        }),
      ).toBe(true);
    });
  });

  describe('paymentBlockedReason', () => {
    it('is null when payment can proceed', () => {
      expect(
        paymentBlockedReason({
          currentOrderId: 'o-1',
          currentOrder: order(OrderType.TAKEAWAY, OrderStatus.PENDING),
          requireServedForDineInPayment: true,
        }),
      ).toBeNull();
    });

    it("returns 'noActiveOrder' when there is no current order id", () => {
      expect(
        paymentBlockedReason({
          currentOrderId: null,
          currentOrder: null,
          requireServedForDineInPayment: false,
        }),
      ).toBe('noActiveOrder');
    });

    it("returns 'dineInPaymentRequiresReadyOrServed' for an unserved dine-in when the gate is on", () => {
      expect(
        paymentBlockedReason({
          currentOrderId: 'o-1',
          currentOrder: order(OrderType.DINE_IN, OrderStatus.PREPARING),
          requireServedForDineInPayment: true,
        }),
      ).toBe('dineInPaymentRequiresReadyOrServed');
    });

    it('is null for a blocked-but-unclassified case (order id present, order object missing)', () => {
      // canProceedToPayment is false (no order object) but currentOrderId is set,
      // so neither specific reason branch matches -> null, matching the original memo.
      expect(
        paymentBlockedReason({
          currentOrderId: 'o-1',
          currentOrder: null,
          requireServedForDineInPayment: true,
        }),
      ).toBeNull();
    });
  });
});

describe('resolvePaymentTarget', () => {
  it('pays the AwaitingPayment order when payingOrderId is set (existing-order payment)', () => {
    expect(
      resolvePaymentTarget({
        payingOrderId: 'served-1',
        payingOrderAmount: 42,
        currentOrderId: 'cart-9',
        currentOrderAmount: 10,
      }),
    ).toEqual({ orderId: 'served-1', amount: 42, wasExistingOrderPayment: true });
  });

  it('pays the active cart order when there is no payingOrderId', () => {
    expect(
      resolvePaymentTarget({
        payingOrderId: null,
        payingOrderAmount: null,
        currentOrderId: 'cart-9',
        currentOrderAmount: 17,
      }),
    ).toEqual({ orderId: 'cart-9', amount: 17, wasExistingOrderPayment: false });
  });

  it('returns null when there is no order to pay', () => {
    expect(
      resolvePaymentTarget({
        payingOrderId: null,
        payingOrderAmount: null,
        currentOrderId: null,
        currentOrderAmount: null,
      }),
    ).toBeNull();
  });

  it('returns null when the chosen amount is null (cannot charge an unknown total)', () => {
    expect(
      resolvePaymentTarget({
        payingOrderId: 'served-1',
        payingOrderAmount: null,
        currentOrderId: 'cart-9',
        currentOrderAmount: 10,
      }),
    ).toBeNull();
  });

  it('allows a zero amount (0 is a valid total, not "no amount")', () => {
    expect(
      resolvePaymentTarget({
        payingOrderId: null,
        payingOrderAmount: null,
        currentOrderId: 'cart-9',
        currentOrderAmount: 0,
      }),
    ).toEqual({ orderId: 'cart-9', amount: 0, wasExistingOrderPayment: false });
  });
});

const ord = (id: string, status: OrderStatus): Pick<Order, 'id' | 'status'> => ({ id, status });

describe('hasRemainingUnpaidOrders', () => {
  it('is false when the only order is the one just paid', () => {
    expect(hasRemainingUnpaidOrders([ord('o-1', OrderStatus.PENDING)], 'o-1')).toBe(false);
  });

  it('is true when another unpaid order remains on the table', () => {
    expect(
      hasRemainingUnpaidOrders(
        [ord('o-1', OrderStatus.PAID), ord('o-2', OrderStatus.PENDING)],
        'o-1',
      ),
    ).toBe(true);
  });

  it('ignores PAID and CANCELLED orders (table can still be freed)', () => {
    expect(
      hasRemainingUnpaidOrders(
        [
          ord('o-1', OrderStatus.PAID),
          ord('o-2', OrderStatus.PAID),
          ord('o-3', OrderStatus.CANCELLED),
        ],
        'o-1',
      ),
    ).toBe(false);
  });

  it('is false for an empty order list', () => {
    expect(hasRemainingUnpaidOrders([], 'o-1')).toBe(false);
  });

  it('counts a SERVED/READY sibling order as still unpaid', () => {
    expect(
      hasRemainingUnpaidOrders(
        [ord('o-1', OrderStatus.PAID), ord('o-2', OrderStatus.SERVED)],
        'o-1',
      ),
    ).toBe(true);
  });
});

const orderItem = (over: Partial<OrderItem>): OrderItem =>
  ({
    id: 'oi-1',
    quantity: 1,
    notes: null,
    product: { id: 'p-1', name: 'Burger', price: 10 } as Product,
    ...over,
  } as OrderItem);

describe('mapOrderItemsToCart', () => {
  it('spreads the product, carries quantity, and coerces empty notes to undefined', () => {
    const cart = mapOrderItemsToCart({
      orderItems: [orderItem({ quantity: 2, notes: '', product: { id: 'p-7', name: 'Fries', price: 5 } as Product })],
    } as Pick<Order, 'orderItems' | 'items'>);
    expect(cart).toEqual([{ id: 'p-7', name: 'Fries', price: 5, quantity: 2, notes: undefined }]);
  });

  it('keeps a real note', () => {
    const cart = mapOrderItemsToCart({
      orderItems: [orderItem({ notes: 'extra cheese' })],
    } as Pick<Order, 'orderItems' | 'items'>);
    expect(cart[0].notes).toBe('extra cheese');
  });

  it('falls back to `items` when `orderItems` is absent (matches the original ||)', () => {
    const cart = mapOrderItemsToCart({
      items: [orderItem({ quantity: 3 })],
    } as Pick<Order, 'orderItems' | 'items'>);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it('returns [] when there are no items', () => {
    expect(mapOrderItemsToCart({} as Pick<Order, 'orderItems' | 'items'>)).toEqual([]);
  });

  // deep-review FH3: loading an existing order must round-trip line-item
  // modifiers, or continuing an OCCUPIED table strips paid modifiers →
  // wrong kitchen ticket + undercharge.
  describe('FH3: modifiers round-trip', () => {
    const orderItemMod = (over: Partial<OrderItemModifier>): OrderItemModifier =>
      ({
        id: 'oim-1',
        orderItemId: 'oi-1',
        modifierId: 'mod-1',
        quantity: 1,
        priceAdjustment: 2.5,
        modifier: { id: 'mod-1', name: 'Extra Cheese', priceAdjustment: 2.5 } as Modifier,
        createdAt: '2026-01-01T00:00:00Z',
        ...over,
      } as OrderItemModifier);

    it('maps each OrderItem modifier into the SelectedModifier cart shape', () => {
      const cart = mapOrderItemsToCart({
        orderItems: [
          orderItem({
            quantity: 2,
            product: { id: 'p-1', name: 'Burger', price: 10 } as Product,
            modifiers: [
              orderItemMod({ modifierId: 'mod-1', quantity: 1, priceAdjustment: 2.5 }),
              orderItemMod({
                id: 'oim-2',
                modifierId: 'mod-2',
                quantity: 2,
                priceAdjustment: 1,
                modifier: { id: 'mod-2', name: 'Large', priceAdjustment: 1 } as Modifier,
              }),
            ],
          }),
        ],
      } as Pick<Order, 'orderItems' | 'items'>);

      expect(cart[0].modifiers).toEqual([
        { modifierId: 'mod-1', name: 'Extra Cheese', priceAdjustment: 2.5, quantity: 1 },
        { modifierId: 'mod-2', name: 'Large', priceAdjustment: 1, quantity: 2 },
      ]);
    });

    it('coerces a string priceAdjustment (Decimal serialization) to a number', () => {
      const cart = mapOrderItemsToCart({
        orderItems: [
          orderItem({
            modifiers: [orderItemMod({ priceAdjustment: '3.75' as unknown as number })],
          }),
        ],
      } as Pick<Order, 'orderItems' | 'items'>);
      expect(cart[0].modifiers?.[0].priceAdjustment).toBe(3.75);
    });

    it('falls back to an empty name when the modifier relation is absent', () => {
      const cart = mapOrderItemsToCart({
        orderItems: [orderItem({ modifiers: [orderItemMod({ modifier: undefined })] })],
      } as Pick<Order, 'orderItems' | 'items'>);
      expect(cart[0].modifiers?.[0].name).toBe('');
    });

    it('round-trips modifiers through buildOrderData as {modifierId, quantity}', () => {
      const cart = mapOrderItemsToCart({
        orderItems: [
          orderItem({
            modifiers: [orderItemMod({ modifierId: 'mod-1', quantity: 3 })],
          }),
        ],
      } as Pick<Order, 'orderItems' | 'items'>);

      const built = buildOrderData({
        isTablelessMode: false,
        selectedTable: { id: 't-1' } as never,
        customerName: '',
        orderNotes: '',
        discount: 0,
        cartItems: cart,
        generateId: () => 'fixed-id',
      });

      expect(built.items[0].modifiers).toEqual([{ modifierId: 'mod-1', quantity: 3 }]);
    });

    it('calculateSubtotal on the loaded cart includes the modifier contribution (no undercharge)', () => {
      const cart = mapOrderItemsToCart({
        orderItems: [
          orderItem({
            quantity: 2,
            product: { id: 'p-1', name: 'Burger', price: 10 } as Product,
            // (10 + 2.5*1) * 2 = 25  — base-only would be 20 (the silent undercharge)
            modifiers: [orderItemMod({ priceAdjustment: 2.5, quantity: 1 })],
          }),
        ],
      } as Pick<Order, 'orderItems' | 'items'>);
      expect(calculateSubtotal(cart)).toBe(25);
    });
  });
});

const product = (id: string): Product => ({ id, name: id, price: 10 } as Product);
const sel = (modifierId: string): SelectedModifier =>
  ({ modifierId, quantity: 1, priceAdjustment: 0 } as SelectedModifier);

describe('mergeCartItem', () => {
  it('appends a new line to an empty cart', () => {
    const out = mergeCartItem([], product('p1'), 2, []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'p1', quantity: 2, modifiers: [] });
  });

  it('increments quantity for the same product with no modifiers', () => {
    const start: CartItem[] = [{ ...product('p1'), quantity: 1, modifiers: [] }];
    const out = mergeCartItem(start, product('p1'), 3, []);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(4);
  });

  it('keeps the same product with a DIFFERENT modifier set as a separate line', () => {
    const start: CartItem[] = [{ ...product('p1'), quantity: 1, modifiers: [sel('m1')] }];
    const out = mergeCartItem(start, product('p1'), 1, [sel('m2')]);
    expect(out).toHaveLength(2);
  });

  it('merges the same product with the SAME modifier set regardless of selection order', () => {
    const start: CartItem[] = [
      { ...product('p1'), quantity: 1, modifiers: [sel('m1'), sel('m2')] },
    ];
    // modifiers supplied in reverse order — sorted key makes them equal
    const out = mergeCartItem(start, product('p1'), 2, [sel('m2'), sel('m1')]);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3);
  });

  it('treats a missing modifiers array on an existing line as the empty set', () => {
    const start: CartItem[] = [{ ...product('p1'), quantity: 1 }];
    const out = mergeCartItem(start, product('p1'), 1, []);
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(2);
  });

  it('does not mutate the input array', () => {
    const start: CartItem[] = [{ ...product('p1'), quantity: 1, modifiers: [] }];
    const snapshot = JSON.parse(JSON.stringify(start));
    mergeCartItem(start, product('p1'), 5, []);
    expect(start).toEqual(snapshot);
  });

  it('keeps different products as separate lines', () => {
    const start: CartItem[] = [{ ...product('p1'), quantity: 1, modifiers: [] }];
    const out = mergeCartItem(start, product('p2'), 1, []);
    expect(out.map((i) => i.id)).toEqual(['p1', 'p2']);
  });
});
