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
});
