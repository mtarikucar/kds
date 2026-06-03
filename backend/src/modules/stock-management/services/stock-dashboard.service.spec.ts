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

  beforeEach(() => {
    prisma = {
      ingredientMovement: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    stockAlerts = {} as any;
    svc = new StockDashboardService(prisma, stockAlerts);
  });

  it('rejects an Invalid-Date startDate', async () => {
    await expect(
      svc.getMovementSummary('t1', 'totally-not-an-iso-string'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an Invalid-Date endDate', async () => {
    await expect(
      svc.getMovementSummary('t1', undefined, 'still-not-a-date'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects startDate > endDate', async () => {
    await expect(
      svc.getMovementSummary('t1', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    ).rejects.toThrow(/before or equal/);
  });

  it('rejects a window > 366 days (the IngredientMovement-table DoS lever)', async () => {
    await expect(
      svc.getMovementSummary('t1', '2024-01-01T00:00:00Z', '2025-06-01T00:00:00Z'),
    ).rejects.toThrow(/366 days/);
  });

  it('forwards a valid window to the Prisma groupBy', async () => {
    await svc.getMovementSummary('t1', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    const where = prisma.ingredientMovement.groupBy.mock.calls[0][0].where;
    expect(where.createdAt.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(where.createdAt.lte).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('omits createdAt when no dates supplied', async () => {
    await svc.getMovementSummary('t1');
    const where = prisma.ingredientMovement.groupBy.mock.calls[0][0].where;
    expect(where.createdAt).toBeUndefined();
  });
});
