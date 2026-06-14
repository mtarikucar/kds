import { describe, it, expect } from 'vitest';
import { buildOrderData } from './buildOrderData';
import { OrderType, type Table } from '../../types';
import type { CartItem } from './posTypes';
import type { SelectedModifier } from '../../components/pos/ProductOptionsModal';

const table = (over: Partial<Table> = {}): Table =>
  ({ id: 'tbl-1', number: 5, ...over } as Table);

const cartItem = (over: Partial<CartItem> = {}): CartItem =>
  ({
    id: 'prod-1',
    price: 10,
    quantity: 1,
    ...over,
  } as CartItem);

const base = {
  customerName: '',
  orderNotes: '',
  discount: 0,
  generateId: () => 'fixed-uuid',
};

describe('buildOrderData order type', () => {
  it('is DINE_IN when a table is selected (table mode)', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      cartItems: [cartItem()],
    });
    expect(data.type).toBe(OrderType.DINE_IN);
    expect(data.tableId).toBe('tbl-1');
  });

  it('is DINE_IN in table mode even with no table (the non-tableless branch)', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: null,
      cartItems: [cartItem()],
    });
    expect(data.type).toBe(OrderType.DINE_IN);
    expect(data.tableId).toBeUndefined();
  });

  it('is TAKEAWAY only when tableless mode AND no selected table', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: true,
      selectedTable: null,
      cartItems: [cartItem()],
    });
    expect(data.type).toBe(OrderType.TAKEAWAY);
    expect(data.tableId).toBeUndefined();
  });

  it('is DINE_IN when tableless mode but a table IS selected', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: true,
      selectedTable: table(),
      cartItems: [cartItem()],
    });
    expect(data.type).toBe(OrderType.DINE_IN);
  });
});

describe('buildOrderData field coercion', () => {
  it('coerces empty customerName / notes to undefined (omitted)', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      customerName: '',
      orderNotes: '',
      cartItems: [cartItem()],
    });
    expect(data.customerName).toBeUndefined();
    expect(data.notes).toBeUndefined();
  });

  it('passes through non-empty customerName / notes / discount', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      customerName: 'Ada',
      orderNotes: 'no onions',
      discount: 5,
      cartItems: [cartItem()],
    });
    expect(data.customerName).toBe('Ada');
    expect(data.notes).toBe('no onions');
    expect(data.discount).toBe(5);
  });
});

describe('buildOrderData items mapping', () => {
  it('maps cart items to {productId, quantity, notes} with mapped modifiers', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      cartItems: [
        cartItem({
          id: 'p-9',
          quantity: 3,
          notes: 'spicy',
          modifiers: [
            { modifierId: 'm-1', quantity: 2, priceAdjustment: 1 } as SelectedModifier,
          ],
        }),
      ],
    });
    expect(data.items).toEqual([
      {
        productId: 'p-9',
        quantity: 3,
        notes: 'spicy',
        modifiers: [{ modifierId: 'm-1', quantity: 2 }],
      },
    ]);
  });

  it('leaves modifiers undefined when the cart item has none', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      cartItems: [cartItem({ id: 'p-2', quantity: 1 })],
    });
    expect(data.items[0].modifiers).toBeUndefined();
  });
});

describe('buildOrderData idempotency key', () => {
  it('uses the injected generator for the idempotency key', () => {
    const data = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      cartItems: [cartItem()],
      generateId: () => 'click-uuid-123',
    });
    expect(data.idempotencyKey).toBe('click-uuid-123');
  });

  it('generates a fresh key per call (stable within a call, distinct across clicks)', () => {
    let n = 0;
    const gen = () => `uuid-${n++}`;
    const a = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      cartItems: [cartItem()],
      generateId: gen,
    });
    const b = buildOrderData({
      ...base,
      isTablelessMode: false,
      selectedTable: table(),
      cartItems: [cartItem()],
      generateId: gen,
    });
    expect(a.idempotencyKey).toBe('uuid-0');
    expect(b.idempotencyKey).toBe('uuid-1');
  });
});
