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
      // withAdvisoryLock now wraps the body in ONE interactive
      // transaction and takes a transaction-scoped lock via
      // `SELECT pg_try_advisory_xact_lock(...) AS locked` (released
      // automatically on commit). Run the interactive callback with
      // tx === prisma so the $queryRawUnsafe stub below drives it.
      (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
      // Stub to return the locked=true row Postgres would emit for the
      // `SELECT pg_try_advisory_xact_lock(...) AS locked` acquire.
      (prisma.$queryRawUnsafe as any).mockResolvedValue([{ locked: true }]);
      (prisma.customerSession.updateMany as any).mockResolvedValue({ count: 2 });
      (prisma.customerSession.deleteMany as any).mockResolvedValue({ count: 3 });

      await svc.sweepSessions();

      // The lock was acquired (the xact-lock query was issued) and the
      // body ran: both writers fire — deactivate sweep AND hard-delete
      // sweep — inside the same (winning) lock acquisition.
      expect(
        (prisma.$queryRawUnsafe as any).mock.calls.some((c: any[]) =>
          /pg_try_advisory(_xact)?_lock/.test(String(c[0])),
        ),
      ).toBe(true);
      expect((prisma.customerSession.updateMany as any).mock.calls.length).toBe(1);
      expect((prisma.customerSession.deleteMany as any).mock.calls.length).toBe(1);
    });

    it('skips both writers when the advisory lock is held by a peer (locked=false)', async () => {
      // Peer replica already holds the xact lock — inside the
      // interactive transaction the acquire returns locked=false, so
      // the helper returns from the callback early without running the
      // body, and neither sweep fires here.
      (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
      (prisma.$queryRawUnsafe as any).mockResolvedValue([{ locked: false }]);

      await svc.sweepSessions();

      expect((prisma.customerSession.updateMany as any).mock.calls.length).toBe(0);
      expect((prisma.customerSession.deleteMany as any).mock.calls.length).toBe(0);
    });
  });

  /**
   * Iter-79 regression — createSession is reachable from the public
   * QR-menu surface. Pre-fix it accepted any string for tenantId /
   * tableId and inserted the row blind, so a multi-IP attacker could
   * flood customer_sessions with spoofed tenant/table UUIDs (each row
   * carrying IP + userAgent + 4h TTL + 30-day retention). Existence
   * checks reject the row BEFORE the insert.
   */
  describe('iter-79 createSession existence checks', () => {
    it('rejects an unknown tenantId with Unauthorized (no row written)', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(svc.createSession('t-bogus')).rejects.toThrow(/invalid tenant/i);
      expect((prisma.customerSession.create as any).mock.calls.length).toBe(0);
    });

    it('rejects a tableId that belongs to a different tenant', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
      prisma.table.findFirst.mockResolvedValue(null); // tenant-scoped lookup misses
      await expect(svc.createSession('t1', 'table-from-tenant-2')).rejects.toThrow(
        /invalid table/i,
      );
      expect((prisma.customerSession.create as any).mock.calls.length).toBe(0);
    });

    it('writes the row when both tenantId and tableId check out', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
      prisma.table.findFirst.mockResolvedValue({ id: 'tab-1' } as any);
      (prisma.customerSession.create as any).mockResolvedValue({
        sessionId: 'sess-1',
        expiresAt: new Date(Date.now() + 4 * 3600_000),
      });

      const out = await svc.createSession('t1', 'tab-1', { userAgent: 'ua', ipAddress: 'ip' });
      expect(out.sessionId).toBe('sess-1');
      // The create payload must carry the validated ids — not a spoofed
      // pair that the caller passed but never verified.
      const data = (prisma.customerSession.create as any).mock.calls[0][0].data;
      expect(data.tenantId).toBe('t1');
      expect(data.tableId).toBe('tab-1');
    });

    it('skips the table check when no tableId is given (counter-only QR sessions)', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1' } as any);
      (prisma.customerSession.create as any).mockResolvedValue({
        sessionId: 's',
        expiresAt: new Date(),
      });

      await svc.createSession('t1');

      expect((prisma.table.findFirst as any).mock.calls.length).toBe(0);
    });
  });
});
