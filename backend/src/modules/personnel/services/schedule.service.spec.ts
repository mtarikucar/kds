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
    it('scopes the shift-template lookup to the actor branch (leak fix)', async () => {
      // A B1 manager must not be able to pass a B2 template id. The
      // lookup WHERE now spreads branchScope(scope), so the query itself
      // is confined to the actor's active branch — an out-of-branch
      // template id finds nothing and 404s instead of leaking.
      (prisma.user.findFirst as any).mockResolvedValue({ id: 'staff-1', tenantId: 't-1' });
      (prisma.shiftTemplate.findFirst as any).mockResolvedValue({
        id: 'tmpl-1', tenantId: 't-1', branchId: 'b-1',
      });
      (prisma.shiftAssignment.create as any).mockImplementation(async ({ data }: any) => ({
        id: 'sa-1', ...data,
      }));

      await svc.assign(scope, {
        userId: 'staff-1', shiftTemplateId: 'tmpl-1', date: '2026-06-01',
      } as any);

      const where = (prisma.shiftTemplate.findFirst as any).mock.calls[0][0].where;
      expect(where.id).toBe('tmpl-1');
      expect(where.tenantId).toBe('t-1');
      expect(where.branchId).toBe('b-1');
    });

    it('404s a cross-branch template id (B1 manager passing a B2 template)', async () => {
      const { NotFoundException } = require('@nestjs/common');
      (prisma.user.findFirst as any).mockResolvedValue({ id: 'staff-1', tenantId: 't-1' });
      // Real branch-scoped query: a B2 template is invisible to a B1 scope,
      // so findFirst resolves null.
      (prisma.shiftTemplate.findFirst as any).mockResolvedValue(null);

      await expect(
        svc.assign(scope, {
          userId: 'staff-1', shiftTemplateId: 'tmpl-b2', date: '2026-06-01',
        } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      // Never reaches the write path.
      expect(prisma.shiftAssignment.create).not.toHaveBeenCalled();
    });

    it('writes branchId derived from the (now branch-scoped) shift template', async () => {
      (prisma.user.findFirst as any).mockResolvedValue({ id: 'staff-1', tenantId: 't-1' });
      (prisma.shiftTemplate.findFirst as any).mockResolvedValue({
        id: 'tmpl-1', tenantId: 't-1', branchId: 'b-1',
      });
      let createData: any = null;
      (prisma.shiftAssignment.create as any).mockImplementation(async ({ data }: any) => {
        createData = data;
        return { id: 'sa-1', ...data };
      });

      await svc.assign(scope, {
        userId: 'staff-1', shiftTemplateId: 'tmpl-1', date: '2026-06-01',
      } as any);

      // The assignment still derives branchId from the template; with the
      // scoped lookup the template is guaranteed to be in the actor branch.
      expect(createData.branchId).toBe('b-1');
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

  /**
   * remove() leak fix: the old signature was remove(id, tenantId) and both
   * the existence check and the delete filtered on tenantId ONLY. Because
   * ShiftAssignment rows are per-branch physical entities, a B1 manager
   * could delete a B2 assignment by id. remove(scope, id) now spreads
   * branchScope(scope) into BOTH the findFirst and the deleteMany.
   */
  describe('remove (branch-scope leak fix)', () => {
    it('branch-scopes BOTH the existence check and the deleteMany', async () => {
      (prisma.shiftAssignment.findFirst as any).mockResolvedValue({ id: 'sa-1' });
      (prisma.shiftAssignment.deleteMany as any).mockResolvedValue({ count: 1 });

      const res = await svc.remove(scope, 'sa-1');

      expect(res).toEqual({ id: 'sa-1' });

      const findWhere = (prisma.shiftAssignment.findFirst as any).mock.calls[0][0]
        .where;
      expect(findWhere.id).toBe('sa-1');
      expect(findWhere.tenantId).toBe('t-1');
      expect(findWhere.branchId).toBe('b-1');

      const delWhere = (prisma.shiftAssignment.deleteMany as any).mock.calls[0][0]
        .where;
      expect(delWhere.id).toBe('sa-1');
      expect(delWhere.tenantId).toBe('t-1');
      expect(delWhere.branchId).toBe('b-1');
    });

    it('404s a cross-branch id without ever deleting (findFirst sees nothing)', async () => {
      const { NotFoundException } = require('@nestjs/common');
      // A B2 row is invisible to the B1-scoped findFirst -> null.
      (prisma.shiftAssignment.findFirst as any).mockResolvedValue(null);

      await expect(svc.remove(scope, 'sa-b2')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.shiftAssignment.deleteMany).not.toHaveBeenCalled();
    });

    it('404s when the row passes the read but the scoped delete removes nothing', async () => {
      const { NotFoundException } = require('@nestjs/common');
      (prisma.shiftAssignment.findFirst as any).mockResolvedValue({ id: 'sa-1' });
      (prisma.shiftAssignment.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.remove(scope, 'sa-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
