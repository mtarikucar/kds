import { DeliveryReconciliationScheduler } from './delivery-reconciliation.scheduler';
import { mockPrismaClient, MockPrismaClient } from '../../../common/test/prisma-mock.service';

/**
 * The daily reconciliation cron must:
 *  - run INSIDE a pg advisory lock (cross-replica single-runner), and
 *  - never let a failure in the reconciliation service crash the tick.
 */
describe('DeliveryReconciliationScheduler', () => {
  let prisma: MockPrismaClient;
  let reconciliationService: { reconcile: jest.Mock };
  let svc: DeliveryReconciliationScheduler;

  beforeEach(() => {
    prisma = mockPrismaClient();
    // New advisory-lock mechanism: withAdvisoryLock runs ONE interactive
    // transaction and takes a tx-scoped lock (released automatically on
    // commit/rollback). Wire $transaction so the interactive callback gets a
    // `tx` === prisma, letting the per-test $queryRawUnsafe stub (which matches
    // the new "pg_try_advisory_xact_lock" SQL) drive the winner/loser
    // decision. This also covers any inner $transaction usage by the service
    // under test.
    (prisma.$transaction as any).mockImplementation(async (cb: any) =>
      typeof cb === 'function' ? cb(prisma) : Promise.all(cb),
    );
    reconciliationService = {
      reconcile: jest
        .fn()
        .mockResolvedValue({ scannedConfigs: 0, driftedConfigs: 0, details: [], ranAt: '' }),
    };
    svc = new DeliveryReconciliationScheduler(
      prisma as any,
      reconciliationService as any,
    );
  });

  it('acquires a tx-scoped pg advisory lock and runs the reconciliation pass', async () => {
    let lockQueried = false;
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) {
        lockQueried = true;
        return [{ locked: true }];
      }
      return [];
    });

    await svc.runReconciliation();

    // Winner: the lock query was issued (acquired) and the body ran. Release is
    // now automatic on tx commit (xact lock), so there is no unlock query to
    // assert — running inside the transaction is the equivalent guarantee.
    expect(lockQueried).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(reconciliationService.reconcile).toHaveBeenCalledTimes(1);
  });

  it('skips the pass when the advisory lock is held by another replica', async () => {
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: false }];
      return [];
    });

    await svc.runReconciliation();

    expect(reconciliationService.reconcile).not.toHaveBeenCalled();
  });

  it('swallows a reconciliation failure so the tick never crashes', async () => {
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
      return [];
    });
    reconciliationService.reconcile.mockRejectedValueOnce(new Error('db blip'));

    await expect(svc.runReconciliation()).resolves.toBeUndefined();
  });
});
