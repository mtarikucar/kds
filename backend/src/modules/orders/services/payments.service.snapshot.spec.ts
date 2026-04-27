import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { OrdersService } from './orders.service';
import { CustomersService } from '../../customers/customers.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ReceiptSnapshotBuilder } from './receipt-snapshot.builder';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Focused test: only verifies that the receiptSnapshot column is written
 * with a v1 shape when a payment is created. Full payment-flow correctness
 * (state transitions, table updates, customer linking, etc.) is out of scope
 * for this spec.
 */
describe('PaymentsService — receipt snapshot persistence', () => {
  let service: PaymentsService;
  let prisma: MockPrismaClient;

  const tenant = {
    id: 'tenant-1',
    name: 'Test Restaurant',
    currency: 'TRY',
  };

  const baseOrder = {
    id: 'order-1',
    orderNumber: 'A-007',
    type: 'DINE_IN',
    status: 'SERVED',
    requiresApproval: false,
    totalAmount: new Prisma.Decimal('100.00'),
    taxAmount: new Prisma.Decimal('18.00'),
    discount: new Prisma.Decimal('0.00'),
    finalAmount: new Prisma.Decimal('118.00'),
    notes: null,
    createdAt: new Date('2026-04-27T10:00:00Z'),
    tenantId: tenant.id,
  };

  const orderWithIncludes = {
    ...baseOrder,
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

  beforeEach(async () => {
    prisma = mockPrismaClient();

    // The transaction runs the callback synchronously with the same prisma mock.
    (prisma.$transaction as any).mockImplementation(
      async (cb: any) => cb(prisma),
    );

    // Lightweight tenant pre-check via OrdersService.
    const ordersServiceMock = {
      findOne: jest.fn().mockResolvedValue(baseOrder),
    };

    const customersServiceMock = {
      findOrCreateByPhone: jest.fn(),
    };

    // Inside the create() transaction:
    //   tx.order.findFirst (tenant pre-check inside tx)
    //   tx.payment.aggregate (existing paid)
    //   tx.tenant.findUnique  (snapshot)
    //   tx.order.findFirst    (snapshot includes)
    //   tx.payment.create     (writes the snapshot)
    //   tx.payment.aggregate  (post-create totals)
    //   tx.order.update       (mark PAID)
    prisma.tenant.findUnique.mockResolvedValue(tenant as any);
    prisma.order.findFirst
      .mockResolvedValueOnce(baseOrder as any) // tenant pre-check
      .mockResolvedValueOnce(orderWithIncludes as any); // for snapshot
    prisma.payment.aggregate.mockResolvedValue({
      _sum: { amount: new Prisma.Decimal('0') },
    } as any);
    (prisma.payment.create as any).mockImplementation(
      async ({ data }: any) => ({
        ...data,
        id: 'pay-1',
        paidAt: new Date('2026-04-27T10:30:00Z'),
        order: orderWithIncludes,
      }),
    );
    prisma.order.update.mockResolvedValue({
      ...baseOrder,
      status: 'PAID',
    } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        ReceiptSnapshotBuilder,
        { provide: PrismaService, useValue: prisma },
        { provide: OrdersService, useValue: ordersServiceMock },
        { provide: CustomersService, useValue: customersServiceMock },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('writes a versioned receiptSnapshot on payment.create', async () => {
    await service.create(
      'order-1',
      { amount: 118, method: 'CASH' } as any,
      'tenant-1',
    );

    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    const callArg = (prisma.payment.create as jest.Mock).mock.calls[0][0];
    const snapshot = callArg.data.receiptSnapshot;

    expect(snapshot).toBeDefined();
    expect(snapshot).not.toBeNull();
    expect(snapshot.version).toBe(1);
    expect(snapshot.restaurant.name).toBe('Test Restaurant');
    expect(snapshot.order.orderNumber).toBe('A-007');
    expect(snapshot.totals.total).toBe('118.00');
    expect(snapshot.payment.method).toBe('CASH');
    expect(Array.isArray(snapshot.items)).toBe(true);
    expect(snapshot.items).toHaveLength(2);
  });

  it('still creates the payment if tenant lookup returns null (graceful degrade)', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    await service.create(
      'order-1',
      { amount: 118, method: 'CASH' } as any,
      'tenant-1',
    );

    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    const callArg = (prisma.payment.create as jest.Mock).mock.calls[0][0];
    // Snapshot is JsonNull when we can't build it — better than crashing the
    // payment, which is the user-visible action.
    expect(callArg.data.receiptSnapshot).toBe(Prisma.JsonNull);
  });
});
