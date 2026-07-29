import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Specs for OrdersContent — review C3 (money): "Reorder" on a past order
 * must NOT re-add combo rows. Combos are stored as a 0₺ parent + child rows
 * carrying the money; naively looping every row re-added the parent at raw
 * menu price AND each child at full menu price (~2× charge). Plain rows are
 * re-added at the CHARGED unit price from the order row (campaign safety),
 * and the guest is told combo lines were skipped.
 */

const addItem = vi.fn();
vi.mock('../../store/cartStore', () => ({
  useCartStore: (selector: (s: unknown) => unknown) => selector({ addItem }),
}));

const toastInfo = vi.fn();
vi.mock('sonner', () => ({
  toast: { info: (...a: unknown[]) => toastInfo(...a), error: vi.fn(), success: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fb?: string) => (typeof fb === 'string' ? fb : k),
  }),
}));

vi.mock('framer-motion', () => {
  const MOTION_ONLY_PROPS = new Set([
    'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'layout',
  ]);
  return {
    motion: new Proxy({}, {
      get: (_t, tag: string) => ({ children, ...p }: any) => {
        const Tag = tag as any;
        const rest = Object.fromEntries(
          Object.entries(p).filter(([k]) => !MOTION_ONLY_PROPS.has(k)),
        );
        return <Tag {...rest}>{children}</Tag>;
      },
    }),
    AnimatePresence: ({ children }: any) => <>{children}</>,
  };
});

vi.mock('./OrderStatusTimeline', () => ({ default: () => null }));

import OrdersContent from './OrdersContent';

const settings: any = {
  primaryColor: '#111',
  secondaryColor: '#222',
};

// Mixed PAST order: one plain (campaign-charged) item + a combo stored as
// 0₺ parent with two money-carrying children.
const mixedOrder: any = {
  id: 'o-1',
  orderNumber: '1001',
  status: 'SERVED',
  createdAt: '2026-07-01T12:00:00.000Z',
  totalAmount: 145,
  orderItems: [
    {
      id: 'oi-plain',
      quantity: 2,
      unitPrice: 25, // CHARGED (campaign) price
      subtotal: 50,
      parentOrderItemId: null,
      notes: null,
      modifiers: [],
      product: { id: 'p-plain', name: 'Ayran', price: 40, productType: 'STANDARD' },
    },
    {
      id: 'oi-combo-parent',
      quantity: 1,
      unitPrice: 0,
      subtotal: 0,
      parentOrderItemId: null,
      notes: null,
      modifiers: [],
      product: { id: 'p-combo', name: 'Mega Menü', price: 95, productType: 'COMBO' },
    },
    {
      id: 'oi-child-1',
      quantity: 1,
      unitPrice: 60,
      subtotal: 60,
      parentOrderItemId: 'oi-combo-parent',
      notes: null,
      modifiers: [],
      product: { id: 'p-burger', name: 'Burger', price: 70, productType: 'STANDARD' },
    },
    {
      id: 'oi-child-2',
      quantity: 1,
      unitPrice: 35,
      subtotal: 35,
      parentOrderItemId: 'oi-combo-parent',
      notes: null,
      modifiers: [],
      product: { id: 'p-cola', name: 'Cola', price: 40, productType: 'STANDARD' },
    },
  ],
};

function renderOrders(orders: any[]) {
  return render(
    <OrdersContent
      orders={orders}
      settings={settings}
      tenantId="t-1"
      tableId={null}
      onCallWaiter={vi.fn()}
      onRequestBill={vi.fn()}
      onBrowseMenu={vi.fn()}
      currency="TRY"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrdersContent — reorder (C3)', () => {
  it('re-adds ONLY plain rows, at the charged unit price, and skips combo parent + children', () => {
    renderOrders([mixedOrder]);
    fireEvent.click(screen.getByText('Reorder'));

    // Exactly one cart add: the plain item. No 0₺ parent, no full-price children.
    expect(addItem).toHaveBeenCalledTimes(1);
    const [product, quantity] = addItem.mock.calls[0];
    expect(product.id).toBe('p-plain');
    // Charged (campaign) price from the order row — NOT the current menu 40.
    expect(product.price).toBe(25);
    expect(quantity).toBe(2);

    // The guest is told combo lines need re-picking from the menu.
    expect(toastInfo).toHaveBeenCalledWith(
      'Combo items were skipped — please add them from the menu again.',
    );
  });

  it('shows no skip notice when the order has no combo rows', () => {
    const plainOnly = {
      ...mixedOrder,
      id: 'o-2',
      orderItems: [mixedOrder.orderItems[0]],
    };
    renderOrders([plainOnly]);
    fireEvent.click(screen.getByText('Reorder'));

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it('skips a combo parent even when productType is missing, via child back-references', () => {
    const legacyPayload = {
      ...mixedOrder,
      id: 'o-3',
      orderItems: mixedOrder.orderItems.map((it: any) =>
        it.id === 'oi-combo-parent'
          ? { ...it, product: { ...it.product, productType: undefined } }
          : it,
      ),
    };
    renderOrders([legacyPayload]);
    fireEvent.click(screen.getByText('Reorder'));

    expect(addItem).toHaveBeenCalledTimes(1);
    expect(addItem.mock.calls[0][0].id).toBe('p-plain');
    expect(toastInfo).toHaveBeenCalled();
  });
});
