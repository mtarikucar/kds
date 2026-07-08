import { BadRequestException } from '@nestjs/common';
import { StockDashboardService } from './stock-dashboard.service';

/**
 * Iter-95 regression for `StockDashboardService.getMovementSummary`.
 *
 * Iter-92 fixed the same iter-87 trap on waste-logs +
 * ingredient-movements but missed the third stock-management endpoint
 * that takes startDate/endDate: the dashboard's movement summary.
 *
 * Pre-fix it did
 *
 *   if (startDate) where.createdAt.gte = new Date(startDate);
 *
 * with no validity check and no upper bound on the window. A
 * malformed ISO produced `Invalid Date` (NaN) → silent empty groupBy;
 * a 1970→2100 query scanned the whole IngredientMovement table for
 * the tenant.
 */
describe('StockDashboardService.getMovementSummary (iter-95)', () => {
  let prisma: any;
  let stockAlerts: any;
  let svc: StockDashboardService;

  // v3 branch-scope: dashboard aggregates take a BranchScope; branchScope
  // fences every aggregate on (tenantId, branchId).
  const SCOPE = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: 'ADMIN',
  } as const;

  beforeEach(() => {
    prisma = {
      ingredientMovement: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    stockAlerts = {} as any;
    svc = new StockDashboardService(prisma, stockAlerts);
  });

  it('rejects an Invalid-Date startDate', async () => {
    await expect(
      svc.getMovementSummary(SCOPE, 'totally-not-an-iso-string'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an Invalid-Date endDate', async () => {
    await expect(
      svc.getMovementSummary(SCOPE, undefined, 'still-not-a-date'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects startDate > endDate', async () => {
    await expect(
      svc.getMovementSummary(SCOPE, '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    ).rejects.toThrow(/before or equal/);
  });

  it('rejects a window > 366 days (the IngredientMovement-table DoS lever)', async () => {
    await expect(
      svc.getMovementSummary(SCOPE, '2024-01-01T00:00:00Z', '2025-06-01T00:00:00Z'),
    ).rejects.toThrow(/366 days/);
  });

  it('forwards a valid window to a branch-fenced Prisma groupBy', async () => {
    await svc.getMovementSummary(SCOPE, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    const where = prisma.ingredientMovement.groupBy.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(where.createdAt.lte).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(where.tenantId).toBe('t1');
    expect(where.branchId).toBe('b1');
  });

  it('omits createdAt when no dates supplied but still fences by branch', async () => {
    await svc.getMovementSummary(SCOPE);
    const where = prisma.ingredientMovement.groupBy.mock.calls[0][0].where;
    expect(where.createdAt).toBeUndefined();
    expect(where.tenantId).toBe('t1');
    expect(where.branchId).toBe('b1');
  });
});

/**
 * v3 branch-scope: getDashboard + getValuation must fence every count /
 * aggregate on (tenantId, branchId) AND pass the branchId down to the
 * stock-alerts low-stock + expiry feeds.
 */
describe('StockDashboardService.getDashboard / getValuation — branch fence', () => {
  const SCOPE = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: 'ADMIN',
  } as const;

  function makePrisma() {
    return {
      stockItem: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ingredientMovement: { findMany: jest.fn().mockResolvedValue([]) },
      wasteLog: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { cost: null }, _count: 0 }),
      },
      purchaseOrder: { count: jest.fn().mockResolvedValue(0) },
    } as any;
  }

  it('getDashboard fences counts/aggregates and forwards branchId to stock-alerts', async () => {
    const prisma = makePrisma();
    const stockAlerts = {
      checkLowStock: jest.fn().mockResolvedValue([]),
      checkExpiringBatches: jest.fn().mockResolvedValue([]),
    } as any;
    const svc = new StockDashboardService(prisma, stockAlerts);

    await svc.getDashboard(SCOPE);

    // Every stockItem.count where is branch-fenced.
    for (const call of prisma.stockItem.count.mock.calls) {
      expect(call[0].where.tenantId).toBe('t1');
      expect(call[0].where.branchId).toBe('b1');
    }
    expect(prisma.purchaseOrder.count.mock.calls[0][0].where.branchId).toBe('b1');
    expect(prisma.ingredientMovement.findMany.mock.calls[0][0].where.branchId).toBe('b1');
    expect(prisma.wasteLog.aggregate.mock.calls[0][0].where.branchId).toBe('b1');
    // stock-alerts receives the branchId so its feeds are branch-scoped.
    expect(stockAlerts.checkLowStock).toHaveBeenCalledWith('t1', 'b1');
    expect(stockAlerts.checkExpiringBatches).toHaveBeenCalledWith('t1', undefined, 'b1');
  });

  it('getValuation fences the stockItem.findMany on (tenantId, branchId)', async () => {
    const prisma = makePrisma();
    const svc = new StockDashboardService(prisma, {} as any);
    await svc.getValuation(SCOPE);
    const where = prisma.stockItem.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.branchId).toBe('b1');
    expect(where.isActive).toBe(true);
  });
});

/**
 * Theoretical-vs-actual usage variance. ORDER_DEDUCTION (net of ORDER_REVERSAL)
 * = recipe-predicted usage; COUNT_ADJUSTMENT = the unexplained shrinkage a
 * physical count reveals, valued at the item's cost.
 */
describe('StockDashboardService.getUsageVariance', () => {
  const SCOPE = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'ADMIN' } as const;
  let prisma: any;
  let svc: StockDashboardService;

  beforeEach(() => {
    prisma = {
      ingredientMovement: { groupBy: jest.fn() },
      stockItem: { findMany: jest.fn() },
    };
    svc = new StockDashboardService(prisma, {} as any);
  });

  it('computes theoretical usage, waste and count-variance valued at cost', async () => {
    prisma.ingredientMovement.groupBy.mockResolvedValue([
      { stockItemId: 'flour', type: 'ORDER_DEDUCTION', _sum: { quantity: -100 } },
      { stockItemId: 'flour', type: 'ORDER_REVERSAL', _sum: { quantity: 10 } },
      { stockItemId: 'flour', type: 'WASTE', _sum: { quantity: -5 } },
      { stockItemId: 'flour', type: 'COUNT_ADJUSTMENT', _sum: { quantity: -8 } },
    ]);
    prisma.stockItem.findMany.mockResolvedValue([
      { id: 'flour', name: 'Flour', unit: 'KG', costPerUnit: 2 },
    ]);

    const res = await svc.getUsageVariance(SCOPE);
    const row = res.items[0];
    expect(row.theoreticalUsage).toBe(90);
    expect(row.wasteUsage).toBe(5);
    expect(row.countVarianceQty).toBe(-8);
    expect(row.varianceValue).toBe(-16);
    expect(row.variancePct).toBe(-8.9);
    expect(res.totals.varianceValue).toBe(-16);
    expect(res.totals.wasteValue).toBe(10);
    expect(res.totals.netUnexplainedLoss).toBe(16);
  });

  it('returns empty totals when there are no movements', async () => {
    prisma.ingredientMovement.groupBy.mockResolvedValue([]);
    const res = await svc.getUsageVariance(SCOPE);
    expect(res.items).toHaveLength(0);
    expect(res.totals.varianceValue).toBe(0);
    expect(prisma.stockItem.findMany).not.toHaveBeenCalled();
  });
});
