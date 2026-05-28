import { ConflictException, NotFoundException } from '@nestjs/common';
import { TablesService } from './tables.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';
import { TableStatus } from '../../common/constants/order-status.enum';

/**
 * Regression specs for the iter-9 defense-in-depth fixes on
 * TablesService.updateStatus and remove. Both methods used to take an
 * id-only update/delete; iter-9 switched them to compound
 * updateMany/deleteMany on (id, tenantId) so a refactor that drops the
 * inner findFirst pre-check can't regress into cross-tenant writes.
 *
 * The transaction + active-order guard is also pinned — concurrent
 * waiters marking a table AVAILABLE while an unpaid order is open was
 * the original bug both wrappers exist to prevent.
 */
describe('TablesService (iter-9 defense-in-depth + active-order guards)', () => {
  let prisma: MockPrismaClient;
  let svc: TablesService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // The service emits realtime updates via KdsGateway after writes;
    // a no-op mock keeps the tests focused on the DB-layer invariants.
    const kdsGateway = { emitTableUpdate: jest.fn() } as any;
    svc = new TablesService(prisma as any, kdsGateway);
    // Forward $transaction work onto the prisma mock so assertions on
    // .table / .order calls inside the tx still work.
    (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
  });

  describe('updateStatus', () => {
    it('writes via updateMany with compound (id, tenantId) WHERE (not id alone)', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1' } as any);
      let updateWhere: any = null;
      (prisma.table.updateMany as any).mockImplementation(async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      });
      (prisma.table.findFirstOrThrow as any).mockResolvedValue({
        id: 'tab-1', tenantId: 't1', status: TableStatus.OCCUPIED,
      } as any);

      await svc.updateStatus('tab-1', { status: TableStatus.OCCUPIED }, 't1');

      // Load-bearing — tenant scope lives at the query layer, not just
      // in the preceding findFirst.
      expect(updateWhere).toEqual({ id: 'tab-1', tenantId: 't1' });
    });

    it('rejects mark-AVAILABLE while active (non-paid, non-cancelled) orders exist', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1' } as any);
      (prisma.order.count as any).mockResolvedValue(2);

      await expect(
        svc.updateStatus('tab-1', { status: TableStatus.AVAILABLE }, 't1'),
      ).rejects.toThrow(ConflictException);

      // The write must NOT fire when the guard trips.
      expect((prisma.table.updateMany as any).mock.calls.length).toBe(0);
    });

    it('skips the active-order guard for non-AVAILABLE statuses', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1' } as any);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      (prisma.table.findFirstOrThrow as any).mockResolvedValue({ id: 'tab-1' } as any);

      await svc.updateStatus('tab-1', { status: TableStatus.OCCUPIED }, 't1');

      // order.count is only called when status === AVAILABLE.
      expect((prisma.order.count as any).mock.calls.length).toBe(0);
    });

    it('throws NotFoundException when the table belongs to a different tenant', async () => {
      // findFirst's compound WHERE returns null for foreign-tenant ids.
      prisma.table.findFirst.mockResolvedValue(null);
      await expect(
        svc.updateStatus('tab-other', { status: TableStatus.OCCUPIED }, 't1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes via deleteMany with compound (id, tenantId) WHERE', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1' } as any);
      (prisma.order.count as any).mockResolvedValue(0);
      let deleteWhere: any = null;
      (prisma.table.deleteMany as any).mockImplementation(async ({ where }: any) => {
        deleteWhere = where;
        return { count: 1 };
      });

      const out = await svc.remove('tab-1', 't1');

      expect(deleteWhere).toEqual({ id: 'tab-1', tenantId: 't1' });
      expect(out).toEqual({ id: 'tab-1' });
    });

    it('refuses delete when active orders reference the table', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1' } as any);
      (prisma.order.count as any).mockResolvedValue(1);

      await expect(svc.remove('tab-1', 't1')).rejects.toThrow(ConflictException);

      // No delete must run when the guard trips — otherwise the
      // tableId FK on the order is left dangling.
      expect((prisma.table.deleteMany as any).mock.calls.length).toBe(0);
    });

    it('throws NotFoundException when the table is missing or cross-tenant', async () => {
      prisma.table.findFirst.mockResolvedValue(null);
      await expect(svc.remove('nope', 't1')).rejects.toThrow(NotFoundException);
    });

    it('deleteMany count=0 also surfaces NotFoundException', async () => {
      // findFirst sees the row (mock), but a concurrent delete from
      // another path could have removed it before our deleteMany runs.
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1' } as any);
      (prisma.order.count as any).mockResolvedValue(0);
      (prisma.table.deleteMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.remove('tab-1', 't1')).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * Iter-59 regression. unmergeTable was the odd one out — update() /
   * updateStatus() / remove() all use compound (id, tenantId) WHEREs on
   * the write to defend against a regression in the preceding
   * tenant-scoped findFirst. unmergeTable was still doing
   * `update({ where: { id } })` without the tenantId clause. iter-59
   * switches it to updateMany with the compound WHERE plus a count check.
   */
  describe('unmergeTable (iter-59 compound WHERE)', () => {
    beforeEach(() => {
      const kdsGateway = { emitTableUnmerge: jest.fn() } as any;
      svc = new TablesService(prisma as any, kdsGateway);
    });

    it('writes via updateMany with compound (id, tenantId) WHERE', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: 'tab-x',
        tenantId: 't1',
        number: '5',
        groupId: 'g-1',
      } as any);
      let detachWhere: any = null;
      (prisma.table.updateMany as any).mockImplementation(async ({ where }: any) => {
        detachWhere = where;
        return { count: 1 };
      });
      (prisma.table.count as any).mockResolvedValue(3);

      await svc.unmergeTable({ tableId: 'tab-x' }, 't1');

      expect(detachWhere).toEqual({ id: 'tab-x', tenantId: 't1' });
    });

    it('surfaces NotFoundException when the detach count is 0 (foreign-tenant or already gone)', async () => {
      prisma.table.findFirst.mockResolvedValue({
        id: 'tab-x',
        tenantId: 't1',
        number: '5',
        groupId: 'g-1',
      } as any);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 0 });

      await expect(svc.unmergeTable({ tableId: 'tab-x' }, 't1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
