import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StockCountsService } from './stock-counts.service';
import {
  IngredientMovementType,
  StockCountStatus,
} from '../../../common/constants/stock-management.enum';

// v3 branch-scope: read/finalize/cancel take a BranchScope. branchScope(scope)
// fences every where on (tenantId, branchId); branchId 'b1' matches the
// item.stockItem.branchId used in these fixtures so movement rows stay 'b1'.
const SCOPE = {
  tenantId: 't1',
  branchId: 'b1',
  userId: 'u1',
  role: 'ADMIN',
} as const;

/**
 * Iter-94 regression for StockCountsService.finalize.
 *
 * Pre-fix:
 *   (1) The status flip IN_PROGRESS → COMPLETED happened at the END of
 *       the loop with no compound WHERE on the current status. Two
 *       concurrent finalize calls would both pass the
 *       `count.status === IN_PROGRESS` pre-check, both apply every
 *       per-item adjustment, then both flip status. Adjustments
 *       double-applied — a single count session adjusted stock twice.
 *
 *   (2) Each per-item update wrote `currentStock: countedQty` — an
 *       absolute set. A concurrent order deduction that committed
 *       between the txn's read of `current.currentStock` and the
 *       write was silently reversed: the count's "set to X" clobbered
 *       the deducted state. Net effect: deducted units "reappeared"
 *       after finalize.
 *
 *   (3) `findAll` accepted any string as the `status` filter and
 *       forwarded it to Prisma — typos produced silent empty lists.
 */
describe('StockCountsService.finalize (iter-94)', () => {
  let prisma: any;
  let tx: any;
  let svc: StockCountsService;

  function setupTx(claimCount = 1) {
    tx = {
      stockCount: {
        updateMany: jest.fn().mockResolvedValue({ count: claimCount }),
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', status: StockCountStatus.COMPLETED }),
      },
      stockItem: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      stockBatch: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      ingredientMovement: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction = jest.fn().mockImplementation(async (fn: any) => fn(tx));
  }

  beforeEach(() => {
    prisma = {
      stockCount: {
        findFirst: jest.fn(),
      },
      $transaction: undefined,
    };
    svc = new StockCountsService(prisma);
  });

  it('claims IN_PROGRESS atomically before applying any adjustment', async () => {
    prisma.stockCount.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      status: StockCountStatus.IN_PROGRESS,
      name: 'Weekly count',
      items: [
        { id: 'i1', stockItemId: 's1', countedQty: new Prisma.Decimal(95), expectedQty: new Prisma.Decimal(100), stockItem: { branchId: 'b1' } },
      ],
    });
    setupTx();
    tx.stockItem.findFirst.mockResolvedValue({ id: 's1', currentStock: new Prisma.Decimal(90) });

    await svc.finalize('c1', SCOPE);

    // Status flip must happen BEFORE any per-item write. updateMany on
    // stockCount is the very first tx call.
    const stockCountUpdateOrder = tx.stockCount.updateMany.mock.invocationCallOrder[0];
    const stockItemUpdateOrder = tx.stockItem.updateMany.mock.invocationCallOrder[0];
    expect(stockCountUpdateOrder).toBeLessThan(stockItemUpdateOrder);

    // Claim has compound WHERE on status, branch-fenced on (tenantId,
    // branchId) — a cross-branch finalize can never flip this row.
    const claim = tx.stockCount.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({
      id: 'c1',
      tenantId: 't1',
      branchId: 'b1',
      status: StockCountStatus.IN_PROGRESS,
    });
    // The per-item lookup + adjustment are also branch-fenced.
    expect(tx.stockItem.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 's1',
      tenantId: 't1',
      branchId: 'b1',
    });
    expect(tx.stockItem.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 's1',
      tenantId: 't1',
      branchId: 'b1',
    });
  });

  it('throws ConflictException when the IN_PROGRESS claim fails (concurrent finalize)', async () => {
    prisma.stockCount.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      status: StockCountStatus.IN_PROGRESS,
      items: [
        { id: 'i1', stockItemId: 's1', countedQty: new Prisma.Decimal(95), expectedQty: new Prisma.Decimal(100), stockItem: { branchId: 'b1' } },
      ],
    });
    setupTx(0); // claim.count = 0 — someone else already finalized

    await expect(svc.finalize('c1', SCOPE)).rejects.toBeInstanceOf(ConflictException);
    // No per-item adjustments should have been issued.
    expect(tx.stockItem.updateMany).not.toHaveBeenCalled();
    expect(tx.ingredientMovement.create).not.toHaveBeenCalled();
  });

  it('writes the adjustment as a delta (increment), not as an absolute set', async () => {
    prisma.stockCount.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      status: StockCountStatus.IN_PROGRESS,
      name: 'Weekly count',
      items: [
        { id: 'i1', stockItemId: 's1', countedQty: new Prisma.Decimal(95), expectedQty: new Prisma.Decimal(100), stockItem: { branchId: 'b1' } },
      ],
    });
    setupTx();
    tx.stockItem.findFirst.mockResolvedValue({ id: 's1', currentStock: new Prisma.Decimal(90) });

    await svc.finalize('c1', SCOPE);

    // Adjustment was 95 - 90 = +5. The write must be an increment, not
    // an absolute set — that's what makes a concurrent decrement
    // compose correctly (final stock = (90 - D) + 5, not 95).
    const updateCall = tx.stockItem.updateMany.mock.calls[0][0];
    expect(updateCall.data).toEqual({
      currentStock: { increment: expect.anything() },
    });
    // The adjustment value itself is +5.
    const adjustment = updateCall.data.currentStock.increment as Prisma.Decimal;
    expect(adjustment.toString()).toBe('5');
  });

  it('skips items with countedQty === null without writing', async () => {
    prisma.stockCount.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      status: StockCountStatus.IN_PROGRESS,
      items: [
        { id: 'i1', stockItemId: 's1', countedQty: new Prisma.Decimal(100), expectedQty: new Prisma.Decimal(100), stockItem: { branchId: 'b1' } },
      ],
    });
    setupTx();
    tx.stockItem.findFirst.mockResolvedValue({ id: 's1', currentStock: new Prisma.Decimal(100) });

    await svc.finalize('c1', SCOPE);
    // Zero-variance item: no write, no movement row.
    expect(tx.stockItem.updateMany).not.toHaveBeenCalled();
    expect(tx.ingredientMovement.create).not.toHaveBeenCalled();
  });

  it('logs an IngredientMovement of type COUNT_ADJUSTMENT carrying the delta', async () => {
    prisma.stockCount.findFirst.mockResolvedValue({
      id: 'c1',
      tenantId: 't1',
      status: StockCountStatus.IN_PROGRESS,
      name: 'Weekly count',
      items: [
        { id: 'i1', stockItemId: 's1', countedQty: new Prisma.Decimal(95), expectedQty: new Prisma.Decimal(100), stockItem: { branchId: 'b1' } },
      ],
    });
    setupTx();
    tx.stockItem.findFirst.mockResolvedValue({ id: 's1', currentStock: new Prisma.Decimal(90) });

    await svc.finalize('c1', SCOPE);
    const move = tx.ingredientMovement.create.mock.calls[0][0].data;
    expect(move.type).toBe(IngredientMovementType.COUNT_ADJUSTMENT);
    expect(move.referenceType).toBe('STOCK_COUNT');
    expect(move.referenceId).toBe('c1');
    // v3.0.0: ingredientMovement.create now carries branchId from the
    // parent stockItem so movement rows are branch-scoped end-to-end.
    expect(move.branchId).toBe('b1');
  });
});

describe('StockCountsService.findAll status allowlist (iter-94)', () => {
  let prisma: any;
  let svc: StockCountsService;

  beforeEach(() => {
    prisma = {
      stockCount: { findMany: jest.fn().mockResolvedValue([]) },
    };
    svc = new StockCountsService(prisma);
  });

  it('rejects an unknown status string (the typo-silent-empty trap)', async () => {
    await expect(svc.findAll(SCOPE, 'DONE' as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards a valid status to Prisma on a branch-fenced where', async () => {
    await svc.findAll(SCOPE, StockCountStatus.IN_PROGRESS);
    const where = prisma.stockCount.findMany.mock.calls[0][0].where;
    expect(where.status).toBe(StockCountStatus.IN_PROGRESS);
    expect(where.tenantId).toBe('t1');
    expect(where.branchId).toBe('b1');
  });

  it('allows no status (lists all) but still fences by branch', async () => {
    await svc.findAll(SCOPE);
    const where = prisma.stockCount.findMany.mock.calls[0][0].where;
    expect(where.status).toBeUndefined();
    expect(where.tenantId).toBe('t1');
    expect(where.branchId).toBe('b1');
  });
});
