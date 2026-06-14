import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TablesService } from './tables.service';
import {
  mockPrismaClient,
  MockPrismaClient,
} from '../../common/test/prisma-mock.service';
import { BranchScope } from '../../common/scoping/branch-scope';
import { UserRole } from '../../common/constants/roles.enum';

/**
 * Spec for the merge/unmerge state-transition logic in TablesService —
 * the branches the existing defense-in-depth spec does not exercise:
 * reuse-existing-group vs mint-new-group, the cross-group ConflictException,
 * and unmerge's "dissolve the group when <=1 member remains" rule.
 */
describe('TablesService merge/unmerge state transitions', () => {
  let prisma: MockPrismaClient;
  let gateway: {
    emitTableMerge: jest.Mock;
    emitTableUnmerge: jest.Mock;
    emitTableUpdate: jest.Mock;
  };
  let svc: TablesService;

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };

  beforeEach(() => {
    prisma = mockPrismaClient();
    gateway = {
      emitTableMerge: jest.fn(),
      emitTableUnmerge: jest.fn(),
      emitTableUpdate: jest.fn(),
    };
    svc = new TablesService(prisma as any, gateway as any);
    (prisma.$transaction as any).mockImplementation(async (work: any) =>
      work(prisma),
    );
  });

  describe('mergeTables', () => {
    it('throws NotFound when fewer tables resolve than were requested (cross-scope)', async () => {
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: '1', groupId: null, branchId: 'b1' },
      ]); // requested 2, found 1

      await expect(
        svc.mergeTables(scope, { tableIds: ['tbl-1', 'tbl-2'] } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.table.updateMany as any).not.toHaveBeenCalled();
    });

    it('refuses to merge tables that already belong to two different groups', async () => {
      (prisma.table.findMany as any).mockResolvedValue([
        { id: 'tbl-1', number: '1', groupId: 'grp-A', branchId: 'b1' },
        { id: 'tbl-2', number: '2', groupId: 'grp-B', branchId: 'b1' },
      ]);

      await expect(
        svc.mergeTables(scope, { tableIds: ['tbl-1', 'tbl-2'] } as any),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.table.updateMany as any).not.toHaveBeenCalled();
    });

    it('reuses the existing groupId when exactly one table is already grouped', async () => {
      (prisma.table.findMany as any)
        // 1st call inside the txn: resolve the requested tables
        .mockResolvedValueOnce([
          { id: 'tbl-1', number: '1', groupId: 'grp-A', branchId: 'b1' },
          { id: 'tbl-2', number: '2', groupId: null, branchId: 'b1' },
        ])
        // 2nd call: getTableGroup re-fetch (must be non-empty to avoid 404)
        .mockResolvedValueOnce([
          {
            id: 'tbl-1',
            number: '1',
            capacity: 4,
            section: null,
            status: 'OCCUPIED',
            orders: [],
          },
        ]);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 2 });

      await svc.mergeTables(scope, { tableIds: ['tbl-1', 'tbl-2'] } as any);

      const data = (prisma.table.updateMany as any).mock.calls[0][0].data;
      // reuses grp-A rather than minting a fresh uuid
      expect(data.groupId).toBe('grp-A');
      // emits the merge event with both table numbers
      expect(gateway.emitTableMerge).toHaveBeenCalledWith('t1', 'b1', {
        groupId: 'grp-A',
        tableNumbers: ['1', '2'],
      });
    });

    it('mints a new groupId when none of the tables are grouped yet', async () => {
      (prisma.table.findMany as any)
        .mockResolvedValueOnce([
          { id: 'tbl-1', number: '1', groupId: null, branchId: 'b1' },
          { id: 'tbl-2', number: '2', groupId: null, branchId: 'b1' },
        ])
        .mockResolvedValueOnce([
          {
            id: 'tbl-1',
            number: '1',
            capacity: 4,
            section: null,
            status: 'OCCUPIED',
            orders: [],
          },
        ]);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 2 });

      await svc.mergeTables(scope, { tableIds: ['tbl-1', 'tbl-2'] } as any);

      const data = (prisma.table.updateMany as any).mock.calls[0][0].data;
      // a freshly minted uuid, not a reused one
      expect(typeof data.groupId).toBe('string');
      expect(data.groupId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe('unmergeTable', () => {
    it('throws BadRequest when the table is not part of any group', async () => {
      (prisma.table.findFirst as any).mockResolvedValue({
        id: 'tbl-1',
        number: '1',
        groupId: null,
        branchId: 'b1',
      });

      await expect(
        svc.unmergeTable(scope, { tableId: 'tbl-1' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('dissolves the whole group when only one member remains after detach', async () => {
      (prisma.table.findFirst as any).mockResolvedValue({
        id: 'tbl-1',
        number: '1',
        groupId: 'grp-A',
        branchId: 'b1',
      });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      // after detaching tbl-1, only 1 table left in grp-A
      (prisma.table.count as any).mockResolvedValue(1);

      await svc.unmergeTable(scope, { tableId: 'tbl-1' } as any);

      // first updateMany detaches tbl-1; second dissolves remaining group
      expect((prisma.table.updateMany as any).mock.calls.length).toBe(2);
      const dissolveWhere = (prisma.table.updateMany as any).mock.calls[1][0]
        .where;
      expect(dissolveWhere.groupId).toBe('grp-A');
      const dissolveData = (prisma.table.updateMany as any).mock.calls[1][0]
        .data;
      expect(dissolveData.groupId).toBeNull();
    });

    it('keeps the group intact when more than one member remains', async () => {
      (prisma.table.findFirst as any).mockResolvedValue({
        id: 'tbl-1',
        number: '1',
        groupId: 'grp-A',
        branchId: 'b1',
      });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });
      // 3 tables still in grp-A => no dissolve
      (prisma.table.count as any).mockResolvedValue(3);

      await svc.unmergeTable(scope, { tableId: 'tbl-1' } as any);

      // only the single detach updateMany; no second dissolve call
      expect((prisma.table.updateMany as any).mock.calls.length).toBe(1);
      expect(gateway.emitTableUnmerge).toHaveBeenCalledWith('t1', 'b1', {
        tableNumber: '1',
        groupId: 'grp-A',
      });
    });
  });

  describe('unmergeAll', () => {
    it('throws NotFound when the group has no tables in scope', async () => {
      (prisma.table.findFirst as any).mockResolvedValue(null);
      (prisma.table.count as any).mockResolvedValue(0);

      await expect(
        svc.unmergeAll(scope, 'grp-empty'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.table.updateMany as any).not.toHaveBeenCalled();
    });

    it('clears the groupId on every member and emits an "all" unmerge', async () => {
      (prisma.table.findFirst as any).mockResolvedValue({ branchId: 'b1' });
      (prisma.table.count as any).mockResolvedValue(4);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 4 });

      await svc.unmergeAll(scope, 'grp-A');

      const data = (prisma.table.updateMany as any).mock.calls[0][0].data;
      expect(data.groupId).toBeNull();
      expect(gateway.emitTableUnmerge).toHaveBeenCalledWith('t1', 'b1', {
        tableNumber: 'all',
        groupId: 'grp-A',
      });
    });
  });
});
