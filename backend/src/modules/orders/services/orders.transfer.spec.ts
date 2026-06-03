import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';
import { TableStatus } from '../../../common/constants/order-status.enum';
import { BranchScope } from '../../../common/scoping/branch-scope';
import { UserRole } from '../../../common/constants/roles.enum';

/**
 * Regression spec for the iter-12 defense-in-depth fix on
 * OrdersService.transferTableOrders. The three writes inside the
 * transaction (order.updateMany + source table.updateMany + target
 * table.updateMany) all gained a tenantId predicate; without those,
 * a regression in the pre-validation would let a cross-tenant id slip
 * through and clobber another tenant's data.
 *
 * v3.0.0 — every write now spreads `branchScope(scope)` so the WHERE
 * clauses carry both `tenantId` AND `branchId`. A MANAGER scoped to
 * branch A can no longer transfer orders onto a sister-branch's table
 * even if a regression in the pre-validation lets a stale id through.
 */
describe('OrdersService.transferTableOrders (iter-12 defense-in-depth + v3 branch scope)', () => {
  let prisma: MockPrismaClient;
  let svc: OrdersService;
  let kdsGateway: any;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // Mock the KdsGateway dep — transferTableOrders calls emit methods
    // after the write, but we only care about the DB-layer invariants.
    kdsGateway = {
      emitTableUpdate: jest.fn(),
      emitOrderUpdate: jest.fn(),
      emitTableTransfer: jest.fn(),
    };
    const receiptSnapshotBuilder = {} as any;
    svc = new OrdersService(prisma as any, receiptSnapshotBuilder, kdsGateway);
    // Forward tx work to the same prisma mock so the inside-tx writes
    // show up in the same .mock.calls list.
    (prisma.$transaction as any).mockImplementation(async (work: any) => work(prisma));
  });

  const scope: BranchScope = {
    tenantId: 't1',
    branchId: 'b1',
    userId: 'u1',
    role: UserRole.MANAGER,
  };
  const validSource = { id: 'src', tenantId: 't1', branchId: 'b1', status: TableStatus.OCCUPIED, number: '1' };
  const validTarget = { id: 'tgt', tenantId: 't1', branchId: 'b1', status: TableStatus.AVAILABLE, number: '2' };

  it('rejects when source and target are the same table', async () => {
    await expect(
      svc.transferTableOrders(scope, { sourceTableId: 'x', targetTableId: 'x' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when source table is cross-scope (findFirst returns null)', async () => {
    prisma.table.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.transferTableOrders(scope, { sourceTableId: 'src', targetTableId: 'tgt' } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects when target table is RESERVED', async () => {
    prisma.table.findFirst
      .mockResolvedValueOnce(validSource as any)
      .mockResolvedValueOnce({ ...validTarget, status: TableStatus.RESERVED } as any);
    await expect(
      svc.transferTableOrders(scope, { sourceTableId: 'src', targetTableId: 'tgt' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects when source has no active orders', async () => {
    prisma.table.findFirst
      .mockResolvedValueOnce(validSource as any)
      .mockResolvedValueOnce(validTarget as any);
    prisma.order.findMany.mockResolvedValueOnce([] as any);

    await expect(
      svc.transferTableOrders(scope, { sourceTableId: 'src', targetTableId: 'tgt' } as any),
    ).rejects.toThrow(BadRequestException);
  });

  // The headline test — pin every write's WHERE clause to make sure
  // (tenantId, branchId) scope can't get refactored out.
  it('writes the order + table updates with compound scope (tenantId+branchId) WHERE inside the tx', async () => {
    prisma.table.findFirst
      .mockResolvedValueOnce(validSource as any)
      .mockResolvedValueOnce(validTarget as any);
    prisma.order.findMany
      // Pre-tx active orders read.
      .mockResolvedValueOnce([
        { id: 'o-1', tableId: 'src', tenantId: 't1', branchId: 'b1', orderItems: [], table: validSource, user: null },
      ] as any)
      // v2.8.97 — in-tx "stillActive" re-read after acquiring the table
      // locks. Must return the same set so transfer proceeds.
      .mockResolvedValueOnce([{ id: 'o-1' }] as any)
      // Final refetch inside the tx after updates (the returned shape).
      .mockResolvedValueOnce([
        { id: 'o-1', tableId: 'tgt', tenantId: 't1', branchId: 'b1', orderItems: [], table: validTarget, user: null },
      ] as any);
    // Lock advisory queries use $queryRaw — no return shape required.
    (prisma.$queryRaw as any).mockResolvedValue([]);
    // remainingOnSource count for the conditional source AVAILABLE flip.
    (prisma.order.count as any).mockResolvedValue(0);

    const updateManyCalls: any[] = [];
    (prisma.order.updateMany as any).mockImplementation(async ({ where, data }: any) => {
      updateManyCalls.push({ table: 'order', where, data });
      return { count: 1 };
    });
    const tableUpdateCalls: any[] = [];
    (prisma.table.updateMany as any).mockImplementation(async ({ where, data }: any) => {
      tableUpdateCalls.push({ where, data });
      return { count: 1 };
    });

    await svc.transferTableOrders(scope, { sourceTableId: 'src', targetTableId: 'tgt' } as any);

    // Load-bearing: order.updateMany WHERE includes (tenantId, branchId).
    expect(updateManyCalls).toHaveLength(1);
    expect(updateManyCalls[0].where).toEqual({ id: { in: ['o-1'] }, tenantId: 't1', branchId: 'b1' });
    expect(updateManyCalls[0].data).toEqual({ tableId: 'tgt' });

    // Load-bearing: BOTH table.updateMany calls include (tenantId, branchId)
    // (one for each side of the transfer — source → AVAILABLE, target → OCCUPIED).
    expect(tableUpdateCalls).toHaveLength(2);
    expect(tableUpdateCalls[0].where).toEqual({ id: 'src', tenantId: 't1', branchId: 'b1' });
    expect(tableUpdateCalls[0].data).toEqual({ status: TableStatus.AVAILABLE });
    expect(tableUpdateCalls[1].where).toEqual({ id: 'tgt', tenantId: 't1', branchId: 'b1' });
    expect(tableUpdateCalls[1].data).toEqual({ status: TableStatus.OCCUPIED });
  });
});
