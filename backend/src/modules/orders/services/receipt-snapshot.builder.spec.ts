import { Prisma } from '@prisma/client';
import {
  ReceiptSnapshotBuilder,
  ReceiptSnapshotV1,
  KitchenTicketSnapshotV1,
} from './receipt-snapshot.builder';

type TenantFixture = { id: string; name: string; currency: string };
type ItemFixture = {
  quantity: number;
  unitPrice: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
  notes: string | null;
  product: { name: string };
  modifiers: Array<{ name: string; additionalPrice?: Prisma.Decimal }>;
};
type OrderFixture = {
  id: string;
  orderNumber: string;
  type: string;
  totalAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  discount: Prisma.Decimal;
  finalAmount: Prisma.Decimal;
  notes: string | null;
  createdAt: Date;
  table: { number: string } | null;
  orderItems: ItemFixture[];
};
type PaymentFixture = {
  method: string;
  transactionId: string | null;
  paidAt: Date | null;
};

const tenant: TenantFixture = {
  id: 'tenant-1',
  name: 'Test Restaurant',
  currency: 'TRY',
};

const order: OrderFixture = {
  id: 'order-1',
  orderNumber: 'A-007',
  type: 'DINE_IN',
  totalAmount: new Prisma.Decimal('100.00'),
  taxAmount: new Prisma.Decimal('18.00'),
  discount: new Prisma.Decimal('0.00'),
  finalAmount: new Prisma.Decimal('118.00'),
  notes: null,
  createdAt: new Date('2026-04-27T10:00:00Z'),
  table: { number: '5' },
  orderItems: [
    {
      quantity: 2,
      unitPrice: new Prisma.Decimal('30.00'),
      totalPrice: new Prisma.Decimal('60.00'),
      notes: null,
      product: { name: 'Adana Kebap' },
      modifiers: [
        { name: 'Acılı', additionalPrice: new Prisma.Decimal('0.00') },
      ],
    },
    {
      quantity: 1,
      unitPrice: new Prisma.Decimal('40.00'),
      totalPrice: new Prisma.Decimal('40.00'),
      notes: 'no salt',
      product: { name: 'Pide' },
      modifiers: [],
    },
  ],
};

const payment: PaymentFixture = {
  method: 'CASH',
  transactionId: null,
  paidAt: new Date('2026-04-27T10:30:00Z'),
};

describe('ReceiptSnapshotBuilder', () => {
  let builder: ReceiptSnapshotBuilder;

  beforeEach(() => {
    builder = new ReceiptSnapshotBuilder();
  });

  describe('buildReceiptSnapshot', () => {
    it('produces a v1 snapshot with restaurant, order, items, totals, and payment', () => {
      const snap: ReceiptSnapshotV1 = builder.buildReceiptSnapshot({
        tenant,
        order,
        payment,
      });

      expect(snap.version).toBe(1);
      expect(snap.restaurant).toEqual({
        name: 'Test Restaurant',
        currency: 'TRY',
      });
      expect(snap.order).toEqual({
        id: 'order-1',
        orderNumber: 'A-007',
        type: 'DINE_IN',
        tableNumber: '5',
        notes: null,
      });
      expect(snap.items).toEqual([
        {
          name: 'Adana Kebap',
          quantity: 2,
          unitPrice: '30.00',
          totalPrice: '60.00',
          modifiers: ['Acılı'],
          notes: null,
        },
        {
          name: 'Pide',
          quantity: 1,
          unitPrice: '40.00',
          totalPrice: '40.00',
          modifiers: [],
          notes: 'no salt',
        },
      ]);
      expect(snap.totals).toEqual({
        subtotal: '100.00',
        tax: '18.00',
        discount: '0.00',
        total: '118.00',
      });
      expect(snap.payment).toEqual({
        method: 'CASH',
        transactionId: null,
        paidAt: '2026-04-27T10:30:00.000Z',
      });
      expect(typeof snap.printedAt).toBe('string');
    });

    it('uses string-formatted Decimals (not JS Number) so receipts never drift', () => {
      const snap = builder.buildReceiptSnapshot({ tenant, order, payment });
      // String type, two-decimal-places. JS Number would risk 30.000000004
      // for arithmetic-derived values.
      expect(snap.totals.total).toBe('118.00');
      expect(snap.items[0].unitPrice).toBe('30.00');
    });

    it('handles a takeaway order without a table', () => {
      const takeawayOrder = { ...order, type: 'TAKEAWAY', table: null };
      const snap = builder.buildReceiptSnapshot({
        tenant,
        order: takeawayOrder,
        payment,
      });
      expect(snap.order.tableNumber).toBeNull();
    });
  });

  describe('buildKitchenTicketSnapshot', () => {
    it('produces a v1 ticket with order header, items + modifiers + per-item notes, and order-level notes', () => {
      const snap: KitchenTicketSnapshotV1 = builder.buildKitchenTicketSnapshot({
        order: { ...order, notes: 'Allergy: nuts' },
      });

      expect(snap.version).toBe(1);
      expect(snap.order).toEqual({
        id: 'order-1',
        orderNumber: 'A-007',
        type: 'DINE_IN',
        tableNumber: '5',
      });
      expect(snap.items).toEqual([
        {
          name: 'Adana Kebap',
          quantity: 2,
          modifiers: ['Acılı'],
          notes: null,
        },
        {
          name: 'Pide',
          quantity: 1,
          modifiers: [],
          notes: 'no salt',
        },
      ]);
      expect(snap.specialInstructions).toBe('Allergy: nuts');
      expect(typeof snap.createdAt).toBe('string');
    });

    it('omits totals and payment from kitchen ticket', () => {
      const snap = builder.buildKitchenTicketSnapshot({ order });
      expect((snap as any).totals).toBeUndefined();
      expect((snap as any).payment).toBeUndefined();
    });
  });
});
