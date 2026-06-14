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

  /**
   * v3 branch-isolation FOUNDATION: the shift-assignment unique key moved
   * from @@unique([userId, date]) to @@unique([userId, date, branchId]). A
   * user CAN now hold a shift in two different branches on the same date;
   * only a second assignment for the SAME (user, date, branch) collides and
   * surfaces as a per-branch P2002 -> 400.
   */
  describe('assign (v3 per-branch unique key)', () => {
    it('writes branchId derived from the shift template (not the actor scope)', async () => {
      (prisma.user.findFirst as any).mockResolvedValue({ id: 'staff-1', tenantId: 't-1' });
      // Template lives in a DIFFERENT branch than the acting scope (b-1).
      (prisma.shiftTemplate.findFirst as any).mockResolvedValue({
        id: 'tmpl-1', tenantId: 't-1', branchId: 'b-template',
      });
      let createData: any = null;
      (prisma.shiftAssignment.create as any).mockImplementation(async ({ data }: any) => {
        createData = data;
        return { id: 'sa-1', ...data };
      });

      await svc.assign(scope, {
        userId: 'staff-1', shiftTemplateId: 'tmpl-1', date: '2026-06-01',
      } as any);

      // The assignment lives where the TEMPLATE lives — this is the branchId
      // that participates in the per-branch unique key.
      expect(createData.branchId).toBe('b-template');
      expect(createData.userId).toBe('staff-1');
    });

    it('maps a P2002 (same user+date+branch already assigned) to a per-branch 400', async () => {
      const { BadRequestException } = require('@nestjs/common');
      (prisma.user.findFirst as any).mockResolvedValue({ id: 'staff-1', tenantId: 't-1' });
      (prisma.shiftTemplate.findFirst as any).mockResolvedValue({
        id: 'tmpl-1', tenantId: 't-1', branchId: 'b-1',
      });
      (prisma.shiftAssignment.create as any).mockRejectedValue({ code: 'P2002' });

      await expect(
        svc.assign(scope, {
          userId: 'staff-1', shiftTemplateId: 'tmpl-1', date: '2026-06-01',
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        svc.assign(scope, {
          userId: 'staff-1', shiftTemplateId: 'tmpl-1', date: '2026-06-01',
        } as any),
      ).rejects.toThrow(/in this branch/);
    });
  });
});
