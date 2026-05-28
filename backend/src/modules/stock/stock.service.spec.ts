import { StockService } from './stock.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { StockMovementType } from '../../common/constants/order-status.enum';

/**
 * Iter-62 regression — getMovements used to issue an unbounded
 * stockMovement.findMany. A long-lived tenant with hundreds of
 * thousands of movements would crash the API process trying to
 * serialise the whole table into one response. The fix wraps every
 * call with `take = min(limit ?? 100, MOVEMENTS_PAGE_HARD_CAP=500)`.
 */
describe('StockService.getMovements pagination (iter-62)', () => {
  let prisma: MockPrismaClient;
  let svc: StockService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new StockService(prisma as any);
    (prisma.stockMovement.findMany as any).mockResolvedValue([]);
  });

  it('caps unspecified limit at the default 100', async () => {
    await svc.getMovements('t1');
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  it('honours an explicit limit', async () => {
    await svc.getMovements('t1', undefined, undefined, undefined, undefined, 50);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(50);
  });

  it('caps a runaway limit at MOVEMENTS_PAGE_HARD_CAP=500 (the load-bearing DoS guard)', async () => {
    await svc.getMovements('t1', undefined, undefined, undefined, undefined, 100_000);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(500);
  });

  it('clamps a non-positive limit up to 1 (defensive against bad parsing)', async () => {
    await svc.getMovements('t1', undefined, undefined, undefined, undefined, 0);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(1);
  });

  it('keeps the tenant scope and orderBy contract', async () => {
    await svc.getMovements('t1', 'p-1', StockMovementType.OUT);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.where.tenantId).toBe('t1');
    expect(args.where.productId).toBe('p-1');
    expect(args.where.type).toBe(StockMovementType.OUT);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });
});
