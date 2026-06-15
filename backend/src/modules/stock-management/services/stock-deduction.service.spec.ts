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

/**
 * v3 branch-isolation FOUNDATION: a product carries one recipe PER BRANCH
 * (@@unique([productId, branchId])), so the Product.recipe relation became
 * one-to-many (Product.recipes). buildDeductions must select the recipe
 * belonging to THIS order's branch — deducting from another branch's recipe
 * would draw down the wrong branch's stock.
 */
describe('StockDeductionService.deductForOrder (v3 per-branch recipe selection)', () => {
  let prisma: MockPrismaClient;
  let svc: StockDeductionService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const settings: any = {
      get: jest.fn().mockResolvedValue({
        enableAutoDeduction: true,
        deductOnStatus: null,
        allowNegativeStock: true,
      }),
    };
    svc = new StockDeductionService(prisma as any, settings);
  });

  it('deducts ONLY the ingredients of the recipe matching the order branch', async () => {
    // Product p1 has two recipes: one for branch b1, one for branch b2.
    // The order is in branch b2, so only b2's recipe (sugar) must deduct;
    // b1's recipe (flour) must be ignored.
    (prisma.order.findFirst as any).mockResolvedValue({
      id: 'ord-1',
      orderNumber: 'ORD-1',
      tenantId: 't1',
      branchId: 'b2',
      stockDeducted: false,
      orderItems: [
        {
          quantity: 1,
          product: {
            recipes: [
              {
                branchId: 'b1',
                yield: 1,
                ingredients: [
                  { stockItemId: 'flour', quantity: '100', stockItem: { name: 'Flour' } },
                ],
              },
              {
                branchId: 'b2',
                yield: 1,
                ingredients: [
                  { stockItemId: 'sugar', quantity: '50', stockItem: { name: 'Sugar' } },
                ],
              },
            ],
          },
        },
      ],
    } as any);

    const txMock: any = {
      order: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      stockItem: { findFirst: jest.fn().mockResolvedValue(null) },
      stockBatch: { findMany: jest.fn().mockResolvedValue([]) },
      ingredientMovement: { create: jest.fn().mockResolvedValue({}) },
    };
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(txMock));

    const result: any = await svc.deductForOrder('ord-1', 't1', undefined, 'user-1');

    // Exactly one deduction, and it is the BRANCH-b2 ingredient (sugar),
    // never branch-b1's flour.
    expect(result.deductions).toHaveLength(1);
    expect(result.deductions[0].stockItemId).toBe('sugar');
  });

  it('deducts nothing when no recipe matches the order branch', async () => {
    // Product only has a recipe for branch b1, but the order is in b2.
    (prisma.order.findFirst as any).mockResolvedValue({
      id: 'ord-2',
      orderNumber: 'ORD-2',
      tenantId: 't1',
      branchId: 'b2',
      stockDeducted: false,
      orderItems: [
        {
          quantity: 1,
          product: {
            recipes: [
              {
                branchId: 'b1',
                yield: 1,
                ingredients: [
                  { stockItemId: 'flour', quantity: '100', stockItem: { name: 'Flour' } },
                ],
              },
            ],
          },
        },
      ],
    } as any);

    // No deductions => the service returns early before opening a txn.
    const result = await svc.deductForOrder('ord-2', 't1', undefined, 'user-1');
    expect(result).toBeUndefined();
    expect((prisma.$transaction as any).mock.calls.length).toBe(0);
  });
});
