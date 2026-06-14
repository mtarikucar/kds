import { KdsService } from './kds.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';

/**
 * Track-1 branch-scope hardening (Task 3).
 *
 * A kitchen display belongs to ONE branch, but the KDS REST methods
 * previously scoped by `tenantId` only — `getKitchenOrders` returned
 * EVERY branch's orders, and `updateOrderStatus` / `cancelOrder` could
 * mutate any branch's order within the tenant (cross-branch IDOR).
 *
 * These specs pin the compound (tenantId, branchId) predicate at the DB
 * boundary for the read path and the mutating claim paths.
 */
describe('KdsService branch scope', () => {
  let prisma: MockPrismaClient;
  let svc: KdsService;
  // Light jest.fn() collaborator mocks matching the real ctor arg order:
  //   (prisma, kdsGateway, deliveryStatusSync?, stockDeductionService?)
  let gateway: {
    emitOrderStatusChange: jest.Mock;
    emitOrderItemStatusChange: jest.Mock;
    emitLowStockAlert: jest.Mock;
  };

  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'KITCHEN',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitOrderStatusChange: jest.fn(),
      emitOrderItemStatusChange: jest.fn(),
      emitLowStockAlert: jest.fn(),
    };
    svc = new KdsService(prisma as any, gateway as any);
  });

  it('getKitchenOrders filters by branchId AND tenantId', async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);

    await svc.getKitchenOrders(scope);

    const where = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });

  it('updateOrderStatus scopes the lookup AND the compound updateMany claim by branchId', async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: 'o-1',
      tenantId: 't-1',
      branchId: 'b-1',
      status: 'PENDING',
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: 'o-1',
      branchId: 'b-1',
      orderItems: [],
    });

    await svc.updateOrderStatus(scope, 'o-1', 'PREPARING' as any);

    // The tenant+branch-bound lookup
    const findWhere = (prisma.order.findFirst as any).mock.calls[0][0].where;
    expect(findWhere.tenantId).toBe('t-1');
    expect(findWhere.branchId).toBe('b-1');
    // The compound TOCTOU claim must also carry the branch predicate so a
    // cross-branch order id can never be claimed.
    const claimWhere = (prisma.order.updateMany as any).mock.calls[0][0].where;
    expect(claimWhere.tenantId).toBe('t-1');
    expect(claimWhere.branchId).toBe('b-1');
  });

  it('cancelOrder scopes the lookup AND the compound cancel claim by branchId', async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: 'o-1',
      tenantId: 't-1',
      branchId: 'b-1',
      status: 'PENDING',
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: 'o-1',
      branchId: 'b-1',
      orderItems: [],
    });

    await svc.cancelOrder(scope, 'o-1');

    const findWhere = (prisma.order.findFirst as any).mock.calls[0][0].where;
    expect(findWhere.tenantId).toBe('t-1');
    expect(findWhere.branchId).toBe('b-1');
    const claimWhere = (prisma.order.updateMany as any).mock.calls[0][0].where;
    expect(claimWhere.tenantId).toBe('t-1');
    expect(claimWhere.branchId).toBe('b-1');
  });

  it('updateOrderItemStatus scopes the item lookup by branch via the order relation', async () => {
    (prisma.orderItem.findFirst as any).mockResolvedValue({
      id: 'i-1',
      orderId: 'o-1',
      status: 'PENDING',
      order: {
        id: 'o-1',
        status: 'PREPARING',
        requiresApproval: false,
        branchId: 'b-1',
      },
    });
    (prisma.orderItem.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.orderItem.findUniqueOrThrow as any).mockResolvedValue({
      id: 'i-1',
      order: { id: 'o-1', branchId: 'b-1' },
    });
    (prisma.orderItem.findMany as any).mockResolvedValue([
      { status: 'PREPARING' },
    ]);

    await svc.updateOrderItemStatus(scope, 'i-1', 'PREPARING' as any);

    const findWhere = (prisma.orderItem.findFirst as any).mock.calls[0][0].where;
    // Relation filter must spread the full branch scope, not just tenantId.
    expect(findWhere.order.tenantId).toBe('t-1');
    expect(findWhere.order.branchId).toBe('b-1');
  });
});

/**
 * Track 2 observability — every committed KDS status write bumps a
 * Prometheus counter labeled by the developer-controlled status enum, so a
 * Grafana panel can show ticket/item throughput per status and alert on
 * anomalies (e.g. tickets stuck never reaching READY).
 *
 * Mirrors the merged stock_movements_total pattern: @Optional() MetricsService
 * injected last in the ctor, increment AFTER the committed DB write, and
 * ?.-guarded so a missing collaborator can never break the business write.
 */
describe('KdsService metrics', () => {
  let prisma: MockPrismaClient;
  let gateway: {
    emitOrderStatusChange: jest.Mock;
    emitOrderItemStatusChange: jest.Mock;
    emitLowStockAlert: jest.Mock;
  };
  let metrics: { incCounter: jest.Mock };
  let svc: KdsService;

  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'KITCHEN',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitOrderStatusChange: jest.fn(),
      emitOrderItemStatusChange: jest.fn(),
      emitLowStockAlert: jest.fn(),
    };
    metrics = { incCounter: jest.fn() };
    // ctor arg order: (prisma, kdsGateway, deliveryStatusSync?,
    // stockDeductionService?, metrics?)
    svc = new KdsService(
      prisma as any,
      gateway as any,
      undefined,
      undefined,
      metrics as any,
    );
  });

  it('updateOrderStatus records kds_ticket_status_total labeled by status', async () => {
    (prisma.order.findFirst as any).mockResolvedValue({
      id: 'o-1',
      tenantId: 't-1',
      branchId: 'b-1',
      status: 'PENDING',
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: 'o-1',
      branchId: 'b-1',
      orderItems: [],
    });

    await svc.updateOrderStatus(scope, 'o-1', 'PREPARING' as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      'kds_ticket_status_total',
      expect.any(String),
      { status: 'PREPARING' },
    );
  });

  it('updateOrderItemStatus records kds_ticket_item_status_total labeled by status', async () => {
    (prisma.orderItem.findFirst as any).mockResolvedValue({
      id: 'i-1',
      orderId: 'o-1',
      status: 'PENDING',
      order: {
        id: 'o-1',
        status: 'PREPARING',
        requiresApproval: false,
        branchId: 'b-1',
      },
    });
    (prisma.orderItem.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.orderItem.findUniqueOrThrow as any).mockResolvedValue({
      id: 'i-1',
      order: { id: 'o-1', branchId: 'b-1' },
    });
    // Not all items READY → updateOrderStatus is NOT recursively triggered,
    // so the only emit is the item-status one.
    (prisma.orderItem.findMany as any).mockResolvedValue([
      { status: 'PREPARING' },
    ]);

    await svc.updateOrderItemStatus(scope, 'i-1', 'PREPARING' as any);

    expect(metrics.incCounter).toHaveBeenCalledWith(
      'kds_ticket_item_status_total',
      expect.any(String),
      { status: 'PREPARING' },
    );
  });

  it('does not throw when no MetricsService is injected (optional dep)', async () => {
    const bare = new KdsService(prisma as any, gateway as any);
    (prisma.order.findFirst as any).mockResolvedValue({
      id: 'o-1',
      tenantId: 't-1',
      branchId: 'b-1',
      status: 'PENDING',
      requiresApproval: false,
    });
    (prisma.order.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.order.findUniqueOrThrow as any).mockResolvedValue({
      id: 'o-1',
      branchId: 'b-1',
      orderItems: [],
    });

    await expect(
      bare.updateOrderStatus(scope, 'o-1', 'PREPARING' as any),
    ).resolves.toBeDefined();
  });
});
