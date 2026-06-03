import { HealthDashboardService } from './health-dashboard.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

describe('HealthDashboardService.branchScore', () => {
  let prisma: MockPrismaClient;
  let svc: HealthDashboardService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new HealthDashboardService(prisma as any);
    // branchScore now validates the branch belongs to the tenant before
    // scoring. Default the ownership check to "yes, branch exists" so the
    // existing test fixtures keep working; specific tests can override.
    (prisma.branch.findFirst as any).mockResolvedValue({ id: 'b1' });
  });

  it('returns score 100 when devices are online and recent fiscal/orders', async () => {
    prisma.device.findMany.mockResolvedValue([
      { status: 'online' }, { status: 'online' }, { status: 'online' },
    ] as any);
    prisma.fiscalReceipt.findFirst.mockResolvedValue({ issuedAt: new Date() } as any);
    prisma.order.findFirst.mockResolvedValue({ createdAt: new Date() } as any);

    const out = await svc.branchScore('t1', 'b1');
    expect(out.score).toBe(100);
    expect(out.pill).toBe('green');
  });

  it('drops the score when devices are offline', async () => {
    prisma.device.findMany.mockResolvedValue([
      { status: 'offline' }, { status: 'offline' }, { status: 'online' },
    ] as any);
    prisma.fiscalReceipt.findFirst.mockResolvedValue({ issuedAt: new Date() } as any);
    prisma.order.findFirst.mockResolvedValue({ createdAt: new Date() } as any);

    const out = await svc.branchScore('t1', 'b1');
    expect(out.score).toBeLessThan(80);
    expect(out.breakdown.devicesOnlinePct).toBe(33);
  });

  it('penalises stale fiscal and order activity past the thresholds', async () => {
    prisma.device.findMany.mockResolvedValue([{ status: 'online' }] as any);
    prisma.fiscalReceipt.findFirst.mockResolvedValue({ issuedAt: new Date(Date.now() - 5 * 3600_000) } as any); // 5h
    prisma.order.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 2 * 3600_000) } as any); // 2h

    const out = await svc.branchScore('t1', 'b1');
    expect(out.score).toBeLessThan(80);
    expect(['yellow', 'red']).toContain(out.pill);
  });

  it('returns nullable ages when no fiscal/orders ever existed', async () => {
    prisma.device.findMany.mockResolvedValue([] as any);
    prisma.fiscalReceipt.findFirst.mockResolvedValue(null);
    prisma.order.findFirst.mockResolvedValue(null);
    const out = await svc.branchScore('t1', 'b1');
    expect(out.breakdown.fiscalAgeMinutes).toBeNull();
    expect(out.breakdown.orderAgeMinutes).toBeNull();
  });

  /**
   * Iter-65 regression. Before this fix lastFiscal + lastOrder were
   * tenant-scoped only — every branch in a tenant inherited the same
   * fiscalAge / orderAge values, so a quiet branch's per-branch health
   * pill rendered identical to the busy HQ branch even when nothing
   * had happened at the quiet branch for hours.
   *
   * Both fixes are asserted by inspecting the actual WHERE clause that
   * reached Prisma — a future refactor that drops the branchId filter
   * fails this suite before it lands.
   */
  describe('iter-65: per-branch scoping for fiscal + order lookups', () => {
    it('scopes the fiscalReceipt lookup by fiscalDevice.branchId', async () => {
      prisma.device.findMany.mockResolvedValue([] as any);
      let fiscalWhere: any = null;
      (prisma.fiscalReceipt.findFirst as any).mockImplementation(async ({ where }: any) => {
        fiscalWhere = where;
        return null;
      });
      prisma.order.findFirst.mockResolvedValue(null);

      await svc.branchScore('t1', 'b-quiet');

      expect(fiscalWhere).toEqual({
        tenantId: 't1',
        status: 'issued',
        fiscalDevice: { branchId: 'b-quiet' },
      });
    });

    it('scopes the order lookup by branchId directly', async () => {
      prisma.device.findMany.mockResolvedValue([] as any);
      prisma.fiscalReceipt.findFirst.mockResolvedValue(null);
      let orderWhere: any = null;
      (prisma.order.findFirst as any).mockImplementation(async ({ where }: any) => {
        orderWhere = where;
        return null;
      });

      await svc.branchScore('t1', 'b-quiet');

      expect(orderWhere).toEqual({ tenantId: 't1', branchId: 'b-quiet' });
    });
  });
});
