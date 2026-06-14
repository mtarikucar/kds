import { describe, it, expect } from 'vitest';
import {
  calculateItemTotal,
  calculateSubtotal,
  calculateTotal,
  canProceedToPayment,
  paymentBlockedReason,
  resolvePaymentTarget,
  hasRemainingUnpaidOrders,
  mapOrderItemsToCart,
  mergeCartItem,
  type PosCartItem,
} from './posCart';
import type { CartItem } from './posTypes';
import { OrderType, OrderStatus, type Order, type OrderItem, type Product } from '../../types';
import type { SelectedModifier } from '../../components/pos/ProductOptionsModal';

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
