import { CustomerOrdersService } from './customer-orders.service';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Iter-25 regression: waiter-request and bill-request dedup.
 *
 * The earlier waiter version ANDed `status active` with `createdAt recent`
 * (60s window). A 70s-old still-PENDING request fell out of the AND and
 * the next customer tap created a SECOND active row — the POS tray ended
 * up with two open requests for the same table.
 *
 * Both should now use OR so that any active row dedupes regardless of
 * age, AND a 60s post-completion throttle still applies.
 */
describe('CustomerOrdersService dedup parity (iter-25)', () => {
  let prisma: MockPrismaClient;
  let svc: CustomerOrdersService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    const sessionService = {
      requireSession: jest.fn().mockResolvedValue({ tenantId: 't1' }),
    } as any;
    const kdsGateway = {
      emitWaiterRequest: jest.fn(),
      emitBillRequest: jest.fn(),
      emitWaiterRequestUpdated: jest.fn(),
      emitBillRequestUpdated: jest.fn(),
      emitNewOrderWithCustomer: jest.fn(),
      emitLowStockAlert: jest.fn(),
    } as any;
    svc = new CustomerOrdersService(
      prisma as any,
      {} as any, // posSettings (unused on these paths)
      kdsGateway,
      {} as any, // customers
      sessionService,
    );
  });

  describe('createWaiterRequest', () => {
    // v3.0.0 — createWaiterRequest now derives branchId from
    // table.branchId and refuses tableless calls with BadRequest.
    // Stub the table lookup once per test so the dedup paths below
    // can keep their iter-25 focus.
    const stubTable = () => {
      (prisma.table.findFirst as any).mockResolvedValue({
        id: 'tbl-1',
        branchId: 'b1',
      });
    };

    it('dedupes against an OLD still-PENDING row (the iter-25 regression)', async () => {
      // 5-minute-old PENDING row. The old AND query would have missed
      // this and created a duplicate; the OR query must return it.
      stubTable();
      const oldPending = {
        id: 'wr-old',
        sessionId: 's1',
        tenantId: 't1',
        status: 'PENDING',
        createdAt: new Date(Date.now() - 5 * 60_000),
        table: null,
      };
      (prisma.waiterRequest.findFirst as any).mockResolvedValue(oldPending);

      const result = await svc.createWaiterRequest({
        sessionId: 's1',
        tableId: 'tbl-1',
      });

      expect(result).toBe(oldPending);
      // Crucially: no new row created.
      expect((prisma.waiterRequest.create as any).mock.calls.length).toBe(0);
    });

    it('dedupes against a RECENT COMPLETED row (60s tap-spam throttle)', async () => {
      stubTable();
      const recentCompleted = {
        id: 'wr-recent',
        sessionId: 's1',
        tenantId: 't1',
        status: 'COMPLETED',
        createdAt: new Date(Date.now() - 10_000), // 10s ago
        table: null,
      };
      (prisma.waiterRequest.findFirst as any).mockResolvedValue(recentCompleted);

      const result = await svc.createWaiterRequest({
        sessionId: 's1',
        tableId: 'tbl-1',
      });

      expect(result).toBe(recentCompleted);
      expect((prisma.waiterRequest.create as any).mock.calls.length).toBe(0);
    });

    it('creates a new row when nothing matches the dedup OR clause', async () => {
      stubTable();
      (prisma.waiterRequest.findFirst as any).mockResolvedValue(null);
      (prisma.waiterRequest.create as any).mockResolvedValue({
        id: 'wr-new',
        branchId: 'b1',
        table: null,
      });

      await svc.createWaiterRequest({
        sessionId: 's1',
        tableId: 'tbl-1',
      });

      expect((prisma.waiterRequest.create as any).mock.calls.length).toBe(1);
      // v3.0.0 — create() must carry the table-derived branchId so
      // the WaiterRequest stream stays branch-correct.
      const createArgs = (prisma.waiterRequest.create as any).mock.calls[0][0];
      expect(createArgs.data.branchId).toBe('b1');
    });

    it('passes an OR (not AND) clause to findFirst — schema regression guard', async () => {
      // Pin the query shape so a future refactor can't silently revert
      // to the buggy AND form. The OR clause is the load-bearing fix.
      stubTable();
      (prisma.waiterRequest.findFirst as any).mockResolvedValue(null);
      (prisma.waiterRequest.create as any).mockResolvedValue({
        branchId: 'b1',
        table: null,
      });

      await svc.createWaiterRequest({
        sessionId: 's1',
        tableId: 'tbl-1',
      });

      const where = (prisma.waiterRequest.findFirst as any).mock.calls[0][0].where;
      expect(where).toHaveProperty('OR');
      expect(Array.isArray(where.OR)).toBe(true);
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('createBillRequest (parity)', () => {
    it('uses the same OR-shaped dedup as waiter (iter-25 parity)', async () => {
      (prisma.table.findFirst as any).mockResolvedValue({
        id: 'tbl-1',
        branchId: 'b1',
      });
      (prisma.billRequest.findFirst as any).mockResolvedValue(null);
      (prisma.billRequest.create as any).mockResolvedValue({
        branchId: 'b1',
        table: null,
      });

      await svc.createBillRequest({
        sessionId: 's1',
        tableId: 'tbl-1',
      });

      const where = (prisma.billRequest.findFirst as any).mock.calls[0][0].where;
      expect(where).toHaveProperty('OR');
      expect(Array.isArray(where.OR)).toBe(true);
      expect(where.OR).toHaveLength(2);
    });
  });

  /**
   * Iter-86 regression. completeWaiterRequest / completeBillRequest
   * used to snapshot the row, then write the snapshot's
   * acknowledgedById OR'd with the completer's userId. A concurrent
   * acknowledgeXRequest call between read and write produced a
   * snapshot with null ack metadata → the OR resolved to the
   * COMPLETER's id → the row claimed "acknowledged by the completer"
   * forever. Audit trail corruption.
   *
   * The fix splits the write into two disjoint status-scoped
   * updateMany predicates inside a transaction: from PENDING
   * (stamp completer as the implicit acknowledger) OR from
   * ACKNOWLEDGED (keep the existing ack metadata untouched).
   */
  describe('iter-86 complete-request acknowledger preservation', () => {
    it('completeWaiterRequest from PENDING stamps completer as the implicit acknowledger', async () => {
      (prisma.waiterRequest.findFirst as any).mockResolvedValue({
        id: 'wr-1',
        tenantId: 't1',
        status: 'PENDING',
        acknowledgedById: null,
        acknowledgedAt: null,
      });
      (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
      const updates: any[] = [];
      (prisma.waiterRequest.updateMany as any).mockImplementation(async (args: any) => {
        updates.push(args);
        // PENDING branch matches first; subsequent ACKNOWLEDGED branch
        // never fires.
        if (args.where.status === 'PENDING') return { count: 1 };
        return { count: 0 };
      });
      (prisma.waiterRequest.findFirstOrThrow as any).mockResolvedValue({ id: 'wr-1' });

      await svc.completeWaiterRequest('wr-1', 'completer-user', 't1');

      // Exactly one updateMany call against the PENDING branch.
      const pendingCalls = updates.filter((u) => u.where.status === 'PENDING');
      expect(pendingCalls).toHaveLength(1);
      expect(pendingCalls[0].data.acknowledgedById).toBe('completer-user');
      expect(pendingCalls[0].data.status).toBe('COMPLETED');
    });

    it('completeWaiterRequest from ACKNOWLEDGED preserves the original acknowledger (the load-bearing race fix)', async () => {
      // Snapshot still shows status='ACKNOWLEDGED' (a concurrent ack
      // landed between the snapshot read and the write). Pre-iter-86
      // shape would have written `acknowledgedById: request.ack || userId`
      // — but request.ack here IS set, so that snapshot path
      // happened to work; the load-bearing race is the OTHER way:
      // PENDING-at-read, ACKNOWLEDGED-at-write. Either way the new
      // shape never writes acknowledgedById in the ACKNOWLEDGED
      // branch, which is what we assert.
      (prisma.waiterRequest.findFirst as any).mockResolvedValue({
        id: 'wr-2',
        tenantId: 't1',
        status: 'ACKNOWLEDGED',
        acknowledgedById: 'original-acker',
        acknowledgedAt: new Date('2026-01-01'),
      });
      (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
      const updates: any[] = [];
      (prisma.waiterRequest.updateMany as any).mockImplementation(async (args: any) => {
        updates.push(args);
        if (args.where.status === 'PENDING') return { count: 0 }; // no-op; row not PENDING
        if (args.where.status === 'ACKNOWLEDGED') return { count: 1 };
        return { count: 0 };
      });
      (prisma.waiterRequest.findFirstOrThrow as any).mockResolvedValue({ id: 'wr-2' });

      await svc.completeWaiterRequest('wr-2', 'completer-user', 't1');

      // The ACKNOWLEDGED-branch update must NOT touch acknowledgedById
      // or acknowledgedAt. That's the load-bearing preservation.
      const acked = updates.find((u) => u.where.status === 'ACKNOWLEDGED');
      expect(acked).toBeDefined();
      expect(acked!.data.acknowledgedById).toBeUndefined();
      expect(acked!.data.acknowledgedAt).toBeUndefined();
      expect(acked!.data.status).toBe('COMPLETED');
      expect(acked!.data.completedAt).toBeInstanceOf(Date);
    });

    it('completeBillRequest applies the same two-branch shape', async () => {
      (prisma.billRequest.findFirst as any).mockResolvedValue({
        id: 'br-1',
        tenantId: 't1',
        status: 'ACKNOWLEDGED',
        acknowledgedById: 'original-acker',
      });
      (prisma.$transaction as any).mockImplementation(async (fn: any) => fn(prisma));
      const updates: any[] = [];
      (prisma.billRequest.updateMany as any).mockImplementation(async (args: any) => {
        updates.push(args);
        if (args.where.status === 'ACKNOWLEDGED') return { count: 1 };
        return { count: 0 };
      });
      (prisma.billRequest.findFirstOrThrow as any).mockResolvedValue({ id: 'br-1' });

      await svc.completeBillRequest('br-1', 'completer-user', 't1');

      const acked = updates.find((u) => u.where.status === 'ACKNOWLEDGED');
      expect(acked).toBeDefined();
      expect(acked!.data.acknowledgedById).toBeUndefined();
    });
  });

  describe('iter-86 active-listing take cap', () => {
    it('getActiveWaiterRequests caps the listing at 200', async () => {
      let captured: any = null;
      (prisma.waiterRequest.findMany as any).mockImplementation(async (args: any) => {
        captured = args;
        return [];
      });

      await svc.getActiveWaiterRequests('t1');

      expect(captured.take).toBe(200);
    });

    it('getActiveBillRequests caps the listing at 200', async () => {
      let captured: any = null;
      (prisma.billRequest.findMany as any).mockImplementation(async (args: any) => {
        captured = args;
        return [];
      });

      await svc.getActiveBillRequests('t1');

      expect(captured.take).toBe(200);
    });
  });
});
