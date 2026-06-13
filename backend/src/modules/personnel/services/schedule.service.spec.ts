import { ScheduleService } from './schedule.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../../common/test/prisma-mock.service';

/**
 * Track-1 branch-scope hardening: the weekly schedule read must filter
 * by the active branch, not just the tenant. A manager pinned to branch
 * A must not see branch B's assignments or staff roster.
 */
describe('ScheduleService branch-scope (track-1)', () => {
  let prisma: MockPrismaClient;
  let svc: ScheduleService;
  const scope = {
    tenantId: 't-1',
    branchId: 'b-1',
    userId: 'u-1',
    role: 'MANAGER',
  } as any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new ScheduleService(prisma as any);
  });

  it('getWeeklySchedule filters assignments by branchId + tenantId', async () => {
    (prisma.shiftAssignment.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);

    await svc.getWeeklySchedule(scope);

    const where = (prisma.shiftAssignment.findMany as any).mock.calls[0][0]
      .where;
    expect(where.branchId).toBe('b-1');
    expect(where.tenantId).toBe('t-1');
  });
});
