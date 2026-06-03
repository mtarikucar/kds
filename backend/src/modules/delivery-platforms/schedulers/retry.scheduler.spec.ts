import { RetryScheduler } from './retry.scheduler';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * Iter-40 regressions:
 *
 *  1. retryFailedOperations must run INSIDE withAdvisoryLock so two
 *     replicas don't both replay the same getFailedOperations(20) rows
 *     and double-call adapter.acceptOrder on the platform.
 *  2. The order lookup inside the retry loop must scope by op.tenantId
 *     (defence-in-depth) so a corrupt log row pointing at another
 *     tenant's order can't drive a cross-tenant status/accept call.
 */
describe('RetryScheduler (iter-40)', () => {
  let prisma: MockPrismaClient;
  let logService: any;
  let statusSyncService: any;
  let authService: any;
  let adapterFactory: any;
  let svc: RetryScheduler;

  beforeEach(() => {
    prisma = mockPrismaClient();
    logService = {
      getFailedOperations: jest.fn().mockResolvedValue([]),
      markRetrySuccess: jest.fn().mockResolvedValue(undefined),
      incrementRetry: jest.fn().mockResolvedValue(undefined),
    };
    statusSyncService = { syncStatusToPlatform: jest.fn() };
    authService = { ensureValidToken: jest.fn() };
    adapterFactory = { getAdapter: jest.fn() };
    svc = new RetryScheduler(
      prisma as any,
      logService,
      statusSyncService,
      authService,
      adapterFactory,
    );
  });

  it('acquires a pg advisory lock before processing (cross-replica safety)', async () => {
    // withAdvisoryLock invokes $queryRawUnsafe with pg_try_advisory_lock.
    // Stub to return locked=true so the inner runRetries fires; then
    // assert the lock query was issued at all.
    let lockQueried = false;
    let unlockQueried = false;
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        lockQueried = true;
        return [{ locked: true }];
      }
      if (sql.includes('pg_advisory_unlock')) {
        unlockQueried = true;
        return [{}];
      }
      return [];
    });

    await svc.retryFailedOperations();

    expect(lockQueried).toBe(true);
    expect(unlockQueried).toBe(true);
    expect(logService.getFailedOperations).toHaveBeenCalled();
  });

  it('SKIPS the retry loop when another replica holds the lock', async () => {
    // Simulate the loser case: lock query returns locked=false.
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: false }];
      return [];
    });

    await svc.retryFailedOperations();

    // Load-bearing: no retry work on the loser replica.
    expect(logService.getFailedOperations).not.toHaveBeenCalled();
  });

  it('isRunning guard short-circuits an overlapping tick on the same pod', async () => {
    let inFlightResolve!: () => void;
    const inFlight = new Promise<void>((r) => {
      inFlightResolve = r;
    });

    // First tick: lock acquired, getFailedOperations hangs on the
    // inFlight promise so the tick stays "running".
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
      return [];
    });
    logService.getFailedOperations.mockReturnValue(inFlight.then(() => []));

    const firstTick = svc.retryFailedOperations();
    // Yield one microtask so the first tick reaches its `await
    // getFailedOperations` suspension point.
    await Promise.resolve();

    // Second tick should bail on the isRunning guard — no new
    // getFailedOperations call (count stays at 1 from the first tick).
    await svc.retryFailedOperations();

    expect(logService.getFailedOperations.mock.calls.length).toBe(1);

    // Let the first tick finish so jest doesn't complain.
    inFlightResolve();
    await firstTick;
  });

  it('scopes order lookup by op.tenantId (defence-in-depth)', async () => {
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
      return [];
    });
    logService.getFailedOperations.mockResolvedValue([
      {
        id: 'log-1',
        action: 'STATUS_UPDATE',
        orderId: 'order-1',
        tenantId: 't1',
      },
    ]);
    (prisma.order.findFirst as any).mockResolvedValue(null);

    await svc.retryFailedOperations();

    // The findFirst WHERE must include BOTH id AND tenantId — a future
    // refactor that drops tenantId would let a corrupt log row drive a
    // cross-tenant order lookup.
    const where = (prisma.order.findFirst as any).mock.calls[0][0].where;
    expect(where).toEqual({ id: 'order-1', tenantId: 't1' });
  });
});
