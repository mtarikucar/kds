import { PerformanceService } from './performance.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Track-1 branch-scope hardening: performance metrics aggregate orders
 * and attendance — both carry a branchId. A manager pinned to branch A
 * must not see branch B's order/attendance-derived metrics.
 */
describe('PerformanceService branch-scope (track-1)', () => {
  let prisma: MockPrismaClient;
  let svc: PerformanceService;
  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'MANAGER',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new PerformanceService(prisma as any);
  });

  it('getEnhancedMetrics scopes orders + attendance by branchId', async () => {
    (prisma.order.findMany as any).mockResolvedValue([]);
    (prisma.attendance.findMany as any).mockResolvedValue([]);

    await svc.getEnhancedMetrics(scope, {} as any);

    const orderWhere = (prisma.order.findMany as any).mock.calls[0][0].where;
    expect(orderWhere.branchId).toBe('b-1');
    expect(orderWhere.tenantId).toBe('t-1');

    const attWhere = (prisma.attendance.findMany as any).mock.calls[0][0].where;
    expect(attWhere.branchId).toBe('b-1');
    expect(attWhere.tenantId).toBe('t-1');
  });

  it('getTrends scopes orders + attendance by branchId', async () => {
    (prisma.order.count as any).mockResolvedValue(0);
    (prisma.order.aggregate as any).mockResolvedValue({
      _sum: { finalAmount: 0 },
      _avg: { finalAmount: 0 },
    });
    (prisma.attendance.aggregate as any).mockResolvedValue({
      _sum: { totalWorkedMinutes: 0 },
    });

    await svc.getTrends(scope, {} as any);

    const orderWhere = (prisma.order.count as any).mock.calls[0][0].where;
    expect(orderWhere.branchId).toBe('b-1');
    expect(orderWhere.tenantId).toBe('t-1');

    const attWhere = (prisma.attendance.aggregate as any).mock.calls[0][0]
      .where;
    expect(attWhere.branchId).toBe('b-1');
    expect(attWhere.tenantId).toBe('t-1');
  });
});
