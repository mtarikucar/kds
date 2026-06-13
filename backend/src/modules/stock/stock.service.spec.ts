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

/**
 * Track 2 observability — every committed stock movement bumps a Prometheus
 * counter labeled by type, so a Grafana panel can show IN/OUT/ADJUSTMENT
 * throughput and alert on anomalies (e.g. a spike in OUT = possible leakage).
 */
describe('StockService.createMovement metrics', () => {
  let prisma: MockPrismaClient;
  let metrics: { incCounter: jest.Mock };
  let svc: StockService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    metrics = { incCounter: jest.fn() };
    svc = new StockService(prisma as any, metrics as any);
    (prisma.product.findFirst as any).mockResolvedValue({
      id: 'p-1',
      tenantId: 't1',
      stockTracked: true,
    });
    (prisma.$transaction as any).mockImplementation((cb: any) => cb(prisma));
    (prisma.product.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.product.findUniqueOrThrow as any).mockResolvedValue({
      currentStock: 5,
    });
    (prisma.stockMovement.create as any).mockResolvedValue({
      id: 'm-1',
      type: StockMovementType.IN,
      product: {},
      user: {},
    });
  });

  it('records stock_movements_total labeled by movement type', async () => {
    await svc.createMovement(
      { productId: 'p-1', type: StockMovementType.IN, quantity: 5 } as any,
      'u1',
      't1',
      'b1',
    );
    expect(metrics.incCounter).toHaveBeenCalledWith(
      'stock_movements_total',
      expect.any(String),
      { type: StockMovementType.IN },
    );
  });

  it('does not throw when no MetricsService is injected (optional dep)', async () => {
    const bare = new StockService(prisma as any);
    await expect(
      bare.createMovement(
        { productId: 'p-1', type: StockMovementType.OUT, quantity: 1 } as any,
        'u1',
        't1',
        'b1',
      ),
    ).resolves.toBeDefined();
  });
});
