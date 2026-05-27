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
    it('dedupes against an OLD still-PENDING row (the iter-25 regression)', async () => {
      // 5-minute-old PENDING row. The old AND query would have missed
      // this and created a duplicate; the OR query must return it.
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
        tableId: undefined as any,
      });

      expect(result).toBe(oldPending);
      // Crucially: no new row created.
      expect((prisma.waiterRequest.create as any).mock.calls.length).toBe(0);
    });

    it('dedupes against a RECENT COMPLETED row (60s tap-spam throttle)', async () => {
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
        tableId: undefined as any,
      });

      expect(result).toBe(recentCompleted);
      expect((prisma.waiterRequest.create as any).mock.calls.length).toBe(0);
    });

    it('creates a new row when nothing matches the dedup OR clause', async () => {
      (prisma.waiterRequest.findFirst as any).mockResolvedValue(null);
      (prisma.waiterRequest.create as any).mockResolvedValue({
        id: 'wr-new',
        table: null,
      });

      await svc.createWaiterRequest({
        sessionId: 's1',
        tableId: undefined as any,
      });

      expect((prisma.waiterRequest.create as any).mock.calls.length).toBe(1);
    });

    it('passes an OR (not AND) clause to findFirst — schema regression guard', async () => {
      // Pin the query shape so a future refactor can't silently revert
      // to the buggy AND form. The OR clause is the load-bearing fix.
      (prisma.waiterRequest.findFirst as any).mockResolvedValue(null);
      (prisma.waiterRequest.create as any).mockResolvedValue({ table: null });

      await svc.createWaiterRequest({
        sessionId: 's1',
        tableId: undefined as any,
      });

      const where = (prisma.waiterRequest.findFirst as any).mock.calls[0][0].where;
      expect(where).toHaveProperty('OR');
      expect(Array.isArray(where.OR)).toBe(true);
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('createBillRequest (parity)', () => {
    it('uses the same OR-shaped dedup as waiter (iter-25 parity)', async () => {
      (prisma.billRequest.findFirst as any).mockResolvedValue(null);
      (prisma.billRequest.create as any).mockResolvedValue({ table: null });

      await svc.createBillRequest({
        sessionId: 's1',
        tableId: undefined as any,
      });

      const where = (prisma.billRequest.findFirst as any).mock.calls[0][0].where;
      expect(where).toHaveProperty('OR');
      expect(Array.isArray(where.OR)).toBe(true);
      expect(where.OR).toHaveLength(2);
    });
  });
});
