import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { KdsGateway } from '../../kds/kds.gateway';
import { ReceiptSnapshotBuilder } from './receipt-snapshot.builder';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Focused test: verifies that orders.service.create writes a versioned
 * kitchenTicketSnapshot via prisma.order.update inside its transaction.
 * Other create-order semantics (validation, retries, stock deduction) are
 * out of scope for this spec.
 */
describe('OrdersService — kitchen ticket snapshot persistence', () => {
  let service: OrdersService;
  let prisma: MockPrismaClient;

  const tenantId = 'tenant-1';
  const userId = 'user-1';

  const product = {
    id: 'p-1',
    name: 'Adana Kebap',
    price: new Prisma.Decimal('30.00'),
    taxRate: 18,
    tenantId,
    isAvailable: true,
  };

  beforeEach(async () => {
    prisma = mockPrismaClient();

    prisma.product.findMany.mockResolvedValue([product] as any);
    prisma.modifier.findMany.mockResolvedValue([] as any);
    prisma.table.findFirst.mockResolvedValue(null as any);

    // The service's withTransaction wrapper calls our callback directly when
    // there's no Sentry tracing configured; mock as identity.
    (prisma.$transaction as any).mockImplementation(
      async (cb: any) => cb(prisma),
    );

    // The first prisma.order.create returns the persisted order with the
    // shape orders.service expects (schema shape: subtotal + nested modifier).
    (prisma.order.create as any).mockImplementation(async ({ data }: any) => ({
      id: 'order-1',
      orderNumber: data.orderNumber,
      type: data.type,
      status: data.status,
      requiresApproval: data.requiresApproval,
      totalAmount: new Prisma.Decimal('60.00'),
      taxAmount: new Prisma.Decimal('10.80'),
      discount: new Prisma.Decimal('0.00'),
      finalAmount: new Prisma.Decimal('60.00'),
      notes: data.notes ?? null,
      tenantId: data.tenantId,
      createdAt: new Date('2026-04-27T10:00:00Z'),
      table: null,
      orderItems: [
        {
          quantity: 2,
          unitPrice: new Prisma.Decimal('30.00'),
          subtotal: new Prisma.Decimal('60.00'),
          notes: null,
          product: { name: 'Adana Kebap' },
          modifiers: [],
        },
      ],
      user: { id: userId, firstName: 'Tester', lastName: 'User' },
    } as any));

    (prisma.order.update as any).mockImplementation(async ({ data, where }: any) => ({
      id: where.id,
      ...data,
    } as any));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        ReceiptSnapshotBuilder,
        { provide: PrismaService, useValue: prisma },
        {
          provide: KdsGateway,
          useValue: {
            emitNewOrder: jest.fn(),
            emitLowStockAlert: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  it('writes a versioned kitchenTicketSnapshot via order.update after create', async () => {
    await service.create(
      {
        type: 'DINE_IN',
        items: [{ productId: 'p-1', quantity: 2 }],
      } as any,
      userId,
      tenantId,
    );

    expect(prisma.order.update).toHaveBeenCalled();
    const updateCalls = (prisma.order.update as jest.Mock).mock.calls;
    const snapshotCall = updateCalls.find(
      (c) => c[0]?.data?.kitchenTicketSnapshot,
    );
    expect(snapshotCall).toBeDefined();
    const snap = snapshotCall![0].data.kitchenTicketSnapshot;
    expect(snap.version).toBe(1);
    expect(snap.order.type).toBe('DINE_IN');
    expect(typeof snap.order.orderNumber).toBe('string');
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].name).toBe('Adana Kebap');
    expect(snap.items[0].quantity).toBe(2);
  });
});
