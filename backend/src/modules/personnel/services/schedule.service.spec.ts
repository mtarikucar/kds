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

  it('getWeeklySchedule roster includes primary-branch staff AND roamers assigned to the branch', async () => {
    // Roster must show staff whose PRIMARY branch is this branch *and* staff
    // assigned to roam here via UserBranchAssignment (primary elsewhere). The
    // old query filtered primaryBranchId only, hiding assignable roamers.
    (prisma.shiftAssignment.findMany as any).mockResolvedValue([]);
    (prisma.user.findMany as any).mockResolvedValue([]);

    await svc.getWeeklySchedule(scope);

    const where = (prisma.user.findMany as any).mock.calls[0][0].where;
    expect(where.tenantId).toBe('t-1');
    expect(where.status).toBe('ACTIVE');
    // The branch axis moved into an OR so it can also match the m:n allow-list.
    expect(where.primaryBranchId).toBeUndefined();
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ primaryBranchId: 'b-1' }]),
    );
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { branchAssignments: { some: { tenantId: 't-1', branchId: 'b-1' } } },
      ]),
    );
  });
});
