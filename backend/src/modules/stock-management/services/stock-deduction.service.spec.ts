import { StockDeductionService } from './stock-deduction.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { IngredientMovementType } from '../../../common/constants/stock-management.enum';

/**
 * Iter-32 regression: the idempotency-check Set for reverseForOrder
 * MUST be read inside the Serializable transaction. The earlier
 * implementation built the Set from a query outside the txn, so two
 * concurrent reverseForOrder calls (cancel + refund firing together —
 * the documented case Serializable was chosen for) both saw an empty
 * Set and both re-created reversal movements → stock double-credited.
 *
 * The test pins this by asserting the existingReversals query is
 * issued on the txn client passed into the $transaction callback,
 * not on the bare prisma client.
 */
describe('StockDeductionService.reverseForOrder (iter-32)', () => {
  let prisma: MockPrismaClient;
  let svc: StockDeductionService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = { get: jest.fn().mockResolvedValue({ enableAutoDeduction: true }) };
    svc = new StockDeductionService(prisma as any, settings);
  });

  it('reads existingReversals on the txn client, not the bare prisma client', async () => {
    // One prior ORDER_DEDUCTION movement that needs reversing.
    (prisma.ingredientMovement.findMany as any).mockResolvedValueOnce([
      {
        id: 'm-1',
        stockItemId: 'stock-1',
        quantity: '-5' as any,
        tenantId: 't1',
        notes: 'Order ORD-1',
      },
    ]);

    // Capture which client the $transaction callback uses.
    const txMock: any = {
      ingredientMovement: {
        findMany: jest.fn().mockResolvedValue([]), // no prior reversals
        create: jest.fn().mockResolvedValue({}),
      },
      stockItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 'stock-1', tenantId: 't1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(txMock));

    await svc.reverseForOrder('order-1', 't1', 'user-1');

    // Load-bearing assertion: existingReversals must be queried on the
    // txn client. If a future refactor moves this query back to the
    // bare prisma client, the txMock's findMany call count stays 0
    // and the test fails.
    expect(txMock.ingredientMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1',
          type: IngredientMovementType.ORDER_REVERSAL,
          referenceType: 'ORDER_REVERSAL',
          referenceId: 'order-1',
        }),
      }),
    );

    // A reversal movement gets created (because the in-txn check
    // returned empty).
    expect(txMock.ingredientMovement.create).toHaveBeenCalled();
  });

  it('skips reversal when the in-txn check finds an existing ORDER_REVERSAL for the stockItem', async () => {
    (prisma.ingredientMovement.findMany as any).mockResolvedValueOnce([
      {
        id: 'm-1',
        stockItemId: 'stock-1',
        quantity: '-5' as any,
        tenantId: 't1',
        notes: 'Order ORD-1',
      },
    ]);

    const txMock: any = {
      ingredientMovement: {
        // In-txn find returns a prior reversal for stock-1 → loop
        // should skip it.
        findMany: jest.fn().mockResolvedValue([{ stockItemId: 'stock-1' }]),
        create: jest.fn().mockResolvedValue({}),
      },
      stockItem: { findFirst: jest.fn(), updateMany: jest.fn() },
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(txMock));

    await svc.reverseForOrder('order-1', 't1', 'user-1');

    // No new reversal movement created — idempotency held.
    expect(txMock.ingredientMovement.create).not.toHaveBeenCalled();
    expect(txMock.stockItem.updateMany).not.toHaveBeenCalled();
  });
});
