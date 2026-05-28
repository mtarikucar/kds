import { CustomerSessionService } from './customer-session.service';
import { mockPrismaClient, MockPrismaClient } from '../../common/test/prisma-mock.service';

/**
 * Iter-77 regression. Before this fix:
 *  - cleanupExpiredSessions had no scheduled caller anywhere in the
 *    codebase, so customer_sessions accumulated indefinitely;
 *  - even when invoked it only flipped isActive=false, never deleted
 *    rows, so the table still grew unboundedly across tenant lifetime;
 *  - getActiveSessions had no take cap and returned customer.phone
 *    (PII) — an admin UI on a busy tenant would otherwise pull every
 *    active session in one response.
 *
 * iter-77 adds @Cron on a sweep method that runs both
 * cleanupExpiredSessions (deactivate) and deleteOldSessions (hard
 * delete past the retention window). The cron is advisory-locked so
 * multi-replica deploys don't fan out the same delete storm.
 */
describe('CustomerSessionService (iter-77 cleanup + cap)', () => {
  let prisma: MockPrismaClient;
  let svc: CustomerSessionService;

  beforeEach(() => {
    prisma = mockPrismaClient();
    svc = new CustomerSessionService(prisma as any);
  });

  describe('getActiveSessions', () => {
    it('caps the listing at 200 (PII bound for the admin dashboard)', async () => {
      let captured: any = null;
      (prisma.customerSession.findMany as any).mockImplementation(async (args: any) => {
        captured = args;
        return [];
      });

      await svc.getActiveSessions('t1');

      expect(captured.take).toBe(200);
      expect(captured.where.tenantId).toBe('t1');
      expect(captured.where.isActive).toBe(true);
    });
  });

  describe('deleteOldSessions', () => {
    it('hard-deletes inactive sessions past the 30-day retention window', async () => {
      let captured: any = null;
      (prisma.customerSession.deleteMany as any).mockImplementation(async (args: any) => {
        captured = args;
        return { count: 5 };
      });

      const count = await svc.deleteOldSessions();

      expect(count).toBe(5);
      // WHERE must scope to (isActive: false) AND lastActivity older than
      // cutoff. A bug that drops isActive would delete LIVE sessions.
      expect(captured.where.isActive).toBe(false);
      expect(captured.where.lastActivity).toEqual({ lt: expect.any(Date) });
      // Cutoff is approximately 30 days ago.
      const cutoff = captured.where.lastActivity.lt as Date;
      const ageMs = Date.now() - cutoff.getTime();
      expect(ageMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
      expect(ageMs).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    });
  });

  describe('sweepSessions cron entrypoint', () => {
    it('runs deactivate + hard-delete inside the advisory lock callback', async () => {
      // withAdvisoryLock uses $queryRawUnsafe for both acquire and
      // release. Stub to return the locked=true row Postgres would
      // emit for `SELECT pg_try_advisory_lock(...) AS locked`.
      (prisma.$queryRawUnsafe as any).mockResolvedValue([{ locked: true }]);
      (prisma.customerSession.updateMany as any).mockResolvedValue({ count: 2 });
      (prisma.customerSession.deleteMany as any).mockResolvedValue({ count: 3 });

      await svc.sweepSessions();

      // Both writers fire — deactivate sweep AND hard-delete sweep —
      // and both inside the same lock acquisition.
      expect((prisma.customerSession.updateMany as any).mock.calls.length).toBe(1);
      expect((prisma.customerSession.deleteMany as any).mock.calls.length).toBe(1);
    });

    it('skips both writers when the advisory lock is held by a peer (locked=false)', async () => {
      // Peer replica already holds the lock — the helper returns early
      // without running the callback, so neither sweep fires here.
      (prisma.$queryRawUnsafe as any).mockResolvedValue([{ locked: false }]);

      await svc.sweepSessions();

      expect((prisma.customerSession.updateMany as any).mock.calls.length).toBe(0);
      expect((prisma.customerSession.deleteMany as any).mock.calls.length).toBe(0);
    });
  });
});
