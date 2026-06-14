import { describe, it, expect } from 'vitest';
import {
  calculateItemTotal,
  calculateSubtotal,
  calculateTotal,
  canProceedToPayment,
  paymentBlockedReason,
  type PosCartItem,
} from './posCart';
import { OrderType, OrderStatus, type Order } from '../../types';
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
