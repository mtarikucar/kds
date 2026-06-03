import { StockService } from './stock.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { StockMovementType } from '../../common/constants/order-status.enum';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Iter-62 regression — getMovements used to issue an unbounded
 * stockMovement.findMany. A long-lived tenant with hundreds of
 * thousands of movements would crash the API process trying to
 * serialise the whole table into one response. The fix wraps every
 * call with `take = min(limit ?? 100, MOVEMENTS_PAGE_HARD_CAP=500)`.
 *
 * v3.0.0 — getMovements now takes a BranchScope first; the where
 * clause spreads `{ tenantId, branchId }` so a MANAGER scoped to
 * branch A can't enumerate branch B's movements.
 */
describe('StockService.getMovements pagination (iter-62 + v3 branch scope)', () => {
  let prisma: MockPrismaClient;
  let svc: StockService;
  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new StockService(prisma as any);
    (prisma.stockMovement.findMany as any).mockResolvedValue([]);
  });

  it('caps unspecified limit at the default 100', async () => {
    await svc.getMovements(scope);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  it('honours an explicit limit', async () => {
    await svc.getMovements(scope, undefined, undefined, undefined, undefined, 50);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(50);
  });

  it('caps a runaway limit at MOVEMENTS_PAGE_HARD_CAP=500 (the load-bearing DoS guard)', async () => {
    await svc.getMovements(scope, undefined, undefined, undefined, undefined, 100_000);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(500);
  });

  it('clamps a non-positive limit up to 1 (defensive against bad parsing)', async () => {
    await svc.getMovements(scope, undefined, undefined, undefined, undefined, 0);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.take).toBe(1);
  });

  it('spreads (tenantId, branchId) scope and keeps the orderBy contract', async () => {
    await svc.getMovements(scope, 'p-1', StockMovementType.OUT);
    const args = (prisma.stockMovement.findMany as any).mock.calls[0][0];
    expect(args.where.tenantId).toBe('t1');
    // v3.0.0 — branchId now also flows into the WHERE.
    expect(args.where.branchId).toBe('b1');
    expect(args.where.productId).toBe('p-1');
    expect(args.where.type).toBe(StockMovementType.OUT);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
  });
});
