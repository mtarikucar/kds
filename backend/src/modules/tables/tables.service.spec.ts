import { ConflictException, NotFoundException } from '@nestjs/common';
import { TablesService } from './tables.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { TableStatus } from '../../common/constants/order-status.enum';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Regression specs for the iter-9 defense-in-depth fixes on
 * TablesService.updateStatus and remove. Both methods used to take an
 * id-only update/delete; iter-9 switched them to compound
 * updateMany/deleteMany on (id, tenantId) so a refactor that drops the
 * inner findFirst pre-check can't regress into cross-tenant writes.
 *
 * v3.0.0 — the compound WHERE is now (id, tenantId, branchId) because
 * every HTTP handler routes through `@CurrentScope()` and the service
 * methods take a `BranchScope` first. The assertions below pin the
 * branchId clause too; without it a MANAGER scoped to branch A could
 * mutate branch B's tables.
 *
 * The transaction + active-order guard is also pinned — concurrent
 * waiters marking a table AVAILABLE while an unpaid order is open was
 * the original bug both wrappers exist to prevent.
 */
describe('TablesService (iter-9 defense-in-depth + v3 branch scope)', () => {
  let prisma: MockPrismaClient;
  let svc: TablesService;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    // The service emits realtime updates via KdsGateway after writes;
    // a no-op mock keeps the tests focused on the DB-layer invariants.
    const kdsGateway = {
      emitTableUpdate: jest.fn(),
      emitTableUnmerge: jest.fn(),
      emitTableMerge: jest.fn(),
    } as any;
    svc = new TablesService(prisma as any, kdsGateway);
    // Forward $transaction work onto the prisma mock so assertions on
    // .table / .order calls inside the tx still work.
    (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
  });

  describe('updateStatus', () => {
    it('writes via updateMany with compound (id, tenantId, branchId) WHERE', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      let updateWhere: any = null;
      (prisma.table.updateMany as any).mockImplementation(async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      });
      (prisma.table.findFirstOrThrow as any).mockResolvedValue({
        id: 'tab-1', tenantId: 't1', branchId: 'b1', status: TableStatus.OCCUPIED,
      } as any);

      await svc.updateStatus(scope, 'tab-1', { status: TableStatus.OCCUPIED });

      // Load-bearing — scope lives at the query layer, not just in the
      // preceding findFirst. v3 adds branchId so cross-branch writes
      // bounce even if a downstream regression drops the findFirst.
      expect(updateWhere).toEqual({ id: 'tab-1', tenantId: 't1', branchId: 'b1' });
    });

    it('rejects mark-AVAILABLE while active (non-paid, non-cancelled) orders exist', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.order.count as any).mockResolvedValue(2);

      await expect(
        svc.updateStatus(scope, 'tab-1', { status: TableStatus.AVAILABLE }),
      ).rejects.toThrow(ConflictException);

      // The write must NOT fire when the guard trips.
      expect((prisma.table.updateMany as any).mock.calls.length).toBe(0);
    });

    it('skips the active-order guard for non-AVAILABLE statuses', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.table.findFirstOrThrow as any).mockResolvedValue({ id: 'tab-1' } as any);

      await svc.updateStatus(scope, 'tab-1', { status: TableStatus.OCCUPIED });

      // order.count is only called when status === AVAILABLE.
      expect((prisma.order.count as any).mock.calls.length).toBe(0);
    });

    it('throws NotFoundException when the table belongs to a different tenant or branch', async () => {
      // findFirst's compound WHERE returns null for cross-scope ids.
      prisma.table.findFirst.mockResolvedValue(null);
      await expect(
        svc.updateStatus(scope, 'tab-other', { status: TableStatus.OCCUPIED }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes via deleteMany with compound (id, tenantId, branchId) WHERE', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.order.count as any).mockResolvedValue(0);
      let deleteWhere: any = null;
      (prisma.table.deleteMany as any).mockImplementation(async ({ where }: any) => {
        deleteWhere = where;
        return { count: 1 };
      });

      const out = await svc.remove(scope, 'tab-1');

      expect(deleteWhere).toEqual({ id: 'tab-1', tenantId: 't1', branchId: 'b1' });
      expect(out).toEqual({ id: 'tab-1' });
    });

    it('refuses delete when active orders reference the table', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.order.count as any).mockResolvedValue(1);

      await expect(svc.remove(scope, 'tab-1')).rejects.toThrow(ConflictException);

      // No delete must run when the guard trips — otherwise the
      // tableId FK on the order is left dangling.
      expect((prisma.table.deleteMany as any).mock.calls.length).toBe(0);
    });

    it('throws NotFoundException when the table is missing or cross-scope', async () => {
      prisma.table.findFirst.mockResolvedValue(null);
      await expect(svc.remove(scope, 'nope')).rejects.toThrow(NotFoundException);
    });

    it('deleteMany count=0 also surfaces NotFoundException', async () => {
      // findFirst sees the row (mock), but a concurrent delete from
      // another path could have removed it before our deleteMany runs.
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.order.count as any).mockResolvedValue(0);
      (prisma.table.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.remove(scope, 'tab-1')).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * Iter-59 regression. unmergeTable was the odd one out — update() /
   * updateStatus() / remove() all use compound (id, tenantId) WHEREs on
   * the write to defend against a regression in the preceding
   * tenant-scoped findFirst. unmergeTable was still doing
   * `update({ where: { id } })` without the tenantId clause. iter-59
   * switches it to updateMany with the compound WHERE plus a count check.
   * v3.0.0 adds branchId to the compound WHERE.
   */
  describe('unmergeTable (iter-59 compound WHERE + v3 branch scope)', () => {
    it('writes via updateMany with compound (id, tenantId, branchId) WHERE', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: 'tab-x',
        tenantId: 't1',
        branchId: 'b1',
        number: '5',
        groupId: 'g-1',
      } as any);
      let detachWhere: any = null;
      (prisma.table.updateMany as any).mockImplementation(async ({ where }: any) => {
        detachWhere = where;
        return { count: 1 };
      });
      (prisma.table.count as any).mockResolvedValue(3);

      await svc.unmergeTable(scope, { tableId: 'tab-x' });

      expect(detachWhere).toEqual({ id: 'tab-x', tenantId: 't1', branchId: 'b1' });
    });

    it('surfaces NotFoundException when the detach count is 0 (cross-scope or already gone)', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: 'tab-x',
        tenantId: 't1',
        branchId: 'b1',
        number: '5',
        groupId: 'g-1',
      } as any);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.unmergeTable(scope, { tableId: 'tab-x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  /**
   * v3.0.0 branch-isolation regressions. The pre-v3 implementation
   * filtered by tenantId only on findAll/mergeTables, letting a MANAGER
   * scoped to branch A read or merge branch B's tables.
   */
  describe('v3 branch isolation', () => {
    it('findAll spreads branchScope (both tenantId AND branchId) into the WHERE', async () => {
      let findWhere: any = null;
      (prisma.table.findMany as any).mockImplementation(async ({ where }: any) => {
        findWhere = where;
        return [];
      });
      // annotateWithUpcomingReservations runs after findAll
      (prisma.reservationSettings.findUnique as any).mockResolvedValue(null);

      await svc.findAll(scope);

      expect(findWhere).toEqual({ tenantId: 't1', branchId: 'b1' });
    });

    it('mergeTables refuses cross-branch tables (lookup short-circuits)', async () => {
      // The compound WHERE excludes the cross-branch table — only the
      // in-scope table matches, so the length check trips.
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tab-a', tenantId: 't1', branchId: 'b1', groupId: null },
      ] as any);

      await expect(
        svc.mergeTables(scope, { tableIds: ['tab-a', 'tab-cross-branch'] }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
