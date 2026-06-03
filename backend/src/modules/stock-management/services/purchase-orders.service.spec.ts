import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { PurchaseOrderStatus } from '../../../common/constants/stock-management.enum';

/**
 * Iter-34 regression: the per-line poItem read in receive() MUST
 * happen on the txn client, not the bare prisma client. The earlier
 * code read poItem.quantityReceived from the outside-txn findOne
 * snapshot, so two concurrent partial receives both saw the same
 * `alreadyReceived=N`, both computed `N+their_qty`, and the second
 * UPDATE clobbered the first (lost update). Pin the query shape.
 */
describe('PurchaseOrdersService.receive (iter-34)', () => {
  let prisma: MockPrismaClient;
  let svc: PurchaseOrdersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new PurchaseOrdersService(prisma as any);
  });

  it('re-reads poItem on the txn client inside the transaction', async () => {
    // Outside-txn findOne (pre-flight status check)
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue({
      id: 'po-1',
      tenantId: 't1',
      status: PurchaseOrderStatus.SUBMITTED,
      orderNumber: 'PO-00001',
      items: [
        {
          id: 'poi-1',
          stockItemId: 'stock-1',
          stockItem: { name: 'Flour' },
          quantityReceived: '0',
          quantityOrdered: '10',
          unitPrice: '5',
        },
      ],
    });

    const txMock: any = {
      purchaseOrderItem: {
        // In-txn re-read — load-bearing for the lost-update fix.
        findFirst: jest.fn().mockResolvedValue({
          id: 'poi-1',
          stockItemId: 'stock-1',
          stockItem: { name: 'Flour' },
          quantityReceived: '0',
          quantityOrdered: '10',
          unitPrice: '5',
        }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          { quantityReceived: '5', quantityOrdered: '10' },
        ]),
      },
      stockItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'stock-1',
          currentStock: '0',
          costPerUnit: '0',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      stockBatch: { create: jest.fn().mockResolvedValue({}) },
      ingredientMovement: { create: jest.fn().mockResolvedValue({}) },
      purchaseOrder: { update: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as any).mockImplementation(async (cb: any, _opts: any) => cb(txMock));

    await svc.receive(
      'po-1',
      { items: [{ purchaseOrderItemId: 'poi-1', quantityReceived: 5 }] } as any,
      't1',
      'user-1',
    );

    // Load-bearing assertion: the second findFirst (per-line) lands on
    // the txn client. If a future refactor moves this back to bare
    // prisma, the txMock call count stays 0 and this test fails.
    expect(txMock.purchaseOrderItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'poi-1',
          purchaseOrderId: 'po-1',
        }),
      }),
    );
  });

  it('rejects over-receive based on the FRESHLY-READ alreadyReceived (not the stale snapshot)', async () => {
    // Outside-txn snapshot says quantityReceived=0 (the stale view).
    (prisma.purchaseOrder.findFirst as any).mockResolvedValue({
      id: 'po-1',
      tenantId: 't1',
      status: PurchaseOrderStatus.SUBMITTED,
      orderNumber: 'PO-00001',
      items: [
        {
          id: 'poi-1',
          stockItemId: 'stock-1',
          stockItem: { name: 'Flour' },
          quantityReceived: '0',
          quantityOrdered: '10',
          unitPrice: '5',
        },
      ],
    });

    const txMock: any = {
      purchaseOrderItem: {
        // In-txn fresh read says we ALREADY received 8 (a concurrent
        // call landed). New attempt of 5 would push us to 13 > 10.
        findFirst: jest.fn().mockResolvedValue({
          id: 'poi-1',
          stockItemId: 'stock-1',
          stockItem: { name: 'Flour' },
          quantityReceived: '8',
          quantityOrdered: '10',
          unitPrice: '5',
        }),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      stockItem: { findUnique: jest.fn(), update: jest.fn() },
      stockBatch: { create: jest.fn() },
      ingredientMovement: { create: jest.fn() },
      purchaseOrder: { update: jest.fn() },
    };
    (prisma.$transaction as any).mockImplementation(async (cb: any, _opts: any) => cb(txMock));

    await expect(
      svc.receive(
        'po-1',
        { items: [{ purchaseOrderItemId: 'poi-1', quantityReceived: 5 }] } as any,
        't1',
      ),
    ).rejects.toThrow(BadRequestException);

    // Critical: NO stock write happened — the guard fired before any
    // mutation, so the over-receive race is properly closed.
    expect(txMock.stockItem.update).not.toHaveBeenCalled();
    expect(txMock.stockBatch.create).not.toHaveBeenCalled();
  });
});
