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
  let availability: { resolvePublicBranchId: jest.Mock };

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
    // ReservationAvailabilityService — only resolvePublicBranchId is
    // consumed (the public customer-table-listing branch resolver).
    availability = { resolvePublicBranchId: jest.fn() };
    svc = new TablesService(prisma as any, kdsGateway, availability as any);
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

  /**
   * v3 read-leak fix: GET /tables/public/:tenantId (anonymous customer
   * table listing) used to filter by tenantId ONLY, exposing EVERY
   * branch's tables to anonymous callers. The fix resolves a single
   * branch via ReservationAvailabilityService.resolvePublicBranchId and
   * pins the findMany to that (tenantId, branchId).
   */
  describe('findAvailableForCustomers (public branch-leak fix)', () => {
    it('filters findMany by the resolved (tenantId, branchId) + status', async () => {
      availability.resolvePublicBranchId.mockResolvedValue('b-main');
      let findWhere: any = null;
      (prisma.table.findMany as any).mockImplementation(async ({ where }: any) => {
        findWhere = where;
        return [];
      });

      await svc.findAvailableForCustomers('t1');

      // Load-bearing: branchId MUST be in the WHERE or the listing leaks
      // every branch's tables to the anonymous customer endpoint.
      expect(findWhere.tenantId).toBe('t1');
      expect(findWhere.branchId).toBe('b-main');
      expect(findWhere.status).toEqual({
        in: [TableStatus.AVAILABLE, TableStatus.OCCUPIED],
      });
    });

    it('forwards an explicit branchId to resolvePublicBranchId (validation/fallback owned there)', async () => {
      availability.resolvePublicBranchId.mockResolvedValue('b-2');
      (prisma.table.findMany as any).mockResolvedValue([]);

      await svc.findAvailableForCustomers('t1', 'b-2');

      expect(availability.resolvePublicBranchId).toHaveBeenCalledWith('t1', 'b-2');
    });

    it('falls back to the resolver when no branchId is supplied (undefined passed through)', async () => {
      availability.resolvePublicBranchId.mockResolvedValue('b-oldest-active');
      let findWhere: any = null;
      (prisma.table.findMany as any).mockImplementation(async ({ where }: any) => {
        findWhere = where;
        return [];
      });

      await svc.findAvailableForCustomers('t1');

      expect(availability.resolvePublicBranchId).toHaveBeenCalledWith('t1', undefined);
      // The resolver's oldest-active fallback id is what scopes the query.
      expect(findWhere.branchId).toBe('b-oldest-active');
    });
  });

  /**
   * v3 branch-isolation FOUNDATION: table numbers are unique PER BRANCH,
   * not per tenant. The schema constraint moved from
   * @@unique([tenantId, number]) to @@unique([tenantId, branchId, number]).
   * These specs pin the service-layer uniqueness check to the new compound
   * key on BOTH create and update.
   */
  describe('v3 per-branch table-number uniqueness', () => {
    const scopeB1: BranchScope = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: UserRole.MANAGER };
    const scopeB2: BranchScope = { tenantId: 't1', branchId: 'b2', userId: 'u1', role: UserRole.MANAGER };

    it('create: dup-check keys on the compound (tenantId, branchId, number)', async () => {
      let dupWhere: any = null;
      (prisma.table.findUnique as any).mockImplementation(async ({ where }: any) => {
        dupWhere = where;
        return null;
      });
      (prisma.table.create as any).mockResolvedValue({ id: 'tab-new' } as any);

      await svc.create(scopeB1, { number: '1', capacity: 4 } as any);

      // Load-bearing: the dedupe must scope by branchId so branch B can
      // still claim number 1 even when branch A already has it.
      expect(dupWhere).toEqual({
        tenantId_branchId_number: { tenantId: 't1', branchId: 'b1', number: '1' },
      });
    });

    it('create: same number in a DIFFERENT branch is ALLOWED', async () => {
      // Branch A owns table #1. The dup-check is keyed on (tenant, branch,
      // number); querying branch B's slot returns null, so the create
      // proceeds. We assert the create fired with branch B's branchId.
      (prisma.table.findUnique as any).mockImplementation(async ({ where }: any) => {
        const { branchId, number } = where.tenantId_branchId_number;
        // Only branch A already has number 1.
        if (branchId === 'b1' && number === '1') {
          return { id: 'tab-a1', tenantId: 't1', branchId: 'b1', number: '1' } as any;
        }
        return null;
      });
      let createData: any = null;
      (prisma.table.create as any).mockImplementation(async ({ data }: any) => {
        createData = data;
        return { id: 'tab-b1', ...data } as any;
      });

      const out = await svc.create(scopeB2, { number: '1', capacity: 2 } as any);

      expect(createData).toMatchObject({ tenantId: 't1', branchId: 'b2', number: '1' });
      expect(out).toBeTruthy();
    });

    it('create: same number in the SAME branch is rejected (409)', async () => {
      (prisma.table.findUnique as any).mockResolvedValue({
        id: 'tab-a1', tenantId: 't1', branchId: 'b1', number: '1',
      } as any);

      await expect(
        svc.create(scopeB1, { number: '1', capacity: 4 } as any),
      ).rejects.toThrow(ConflictException);

      // The collision must short-circuit before any write.
      expect((prisma.table.create as any).mock.calls.length).toBe(0);
    });

    it('update: rename dup-check keys on the compound (tenantId, branchId, number)', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1', number: '1' } as any);
      let dupWhere: any = null;
      (prisma.table.findUnique as any).mockImplementation(async ({ where }: any) => {
        dupWhere = where;
        return null; // no collision
      });
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.update(scopeB1, 'tab-1', { number: '7' } as any);

      expect(dupWhere).toEqual({
        tenantId_branchId_number: { tenantId: 't1', branchId: 'b1', number: '7' },
      });
    });

    it('update: rename onto a number used by ANOTHER table in the same branch is rejected (409)', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1', number: '1' } as any);
      // A different table already owns number 7 in the same branch.
      (prisma.table.findUnique as any).mockResolvedValue({
        id: 'tab-other', tenantId: 't1', branchId: 'b1', number: '7',
      } as any);

      await expect(
        svc.update(scopeB1, 'tab-1', { number: '7' } as any),
      ).rejects.toThrow(ConflictException);
    });
  });

  /**
   * fake-working-sweep-3 M3 regression. PATCH /tables/:id (the generic
   * update) wrote `data: updateTableDto` directly with NO active-order
   * check, while PATCH /tables/:id/status (updateStatus) refuses to mark a
   * table AVAILABLE that still has an unpaid order. Since UpdateTableDto =
   * PartialType(CreateTableDto) and CreateTableDto carries an optional
   * `status`, an operator could free an occupied table with an open bill
   * via the admin edit modal's status dropdown. update() now applies the
   * same guard inside a transaction. These specs pin it.
   */
  describe('update active-order guard (status: AVAILABLE)', () => {
    it('rejects mark-AVAILABLE via update() while active orders exist', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.order.count as any).mockResolvedValue(1);

      await expect(
        svc.update(scope, 'tab-1', { status: TableStatus.AVAILABLE } as any),
      ).rejects.toThrow(ConflictException);

      // The write must NOT fire when the guard trips — the table cannot
      // be freed while an unpaid bill is open.
      expect((prisma.table.updateMany as any).mock.calls.length).toBe(0);
    });

    it('allows mark-AVAILABLE via update() when no active orders exist', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.order.count as any).mockResolvedValue(0);
      let updateWhere: any = null;
      (prisma.table.updateMany as any).mockImplementation(async ({ where }: any) => {
        updateWhere = where;
        return { count: 1 };
      });

      await svc.update(scope, 'tab-1', { status: TableStatus.AVAILABLE } as any);

      expect(updateWhere).toEqual({ id: 'tab-1', tenantId: 't1', branchId: 'b1' });
    });

    it('skips the active-order count for non-AVAILABLE status writes (e.g. OCCUPIED)', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1' } as any);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.update(scope, 'tab-1', { status: TableStatus.OCCUPIED } as any);

      // order.count only runs when status === AVAILABLE.
      expect((prisma.order.count as any).mock.calls.length).toBe(0);
    });

    it('skips the active-order count for status-less updates (number/capacity only)', async () => {
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1', tenantId: 't1', branchId: 'b1', number: '1' } as any);
      (prisma.table.findUnique as any).mockResolvedValue(null);
      (prisma.table.updateMany as any).mockResolvedValue({ count: 1 });

      await svc.update(scope, 'tab-1', { capacity: 6 } as any);

      expect((prisma.order.count as any).mock.calls.length).toBe(0);
    });
  });
});
