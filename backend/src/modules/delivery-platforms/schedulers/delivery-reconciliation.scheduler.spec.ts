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

  it('acquires + releases a pg advisory lock around the reconciliation pass', async () => {
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

    await svc.runReconciliation();

    expect(lockQueried).toBe(true);
    expect(unlockQueried).toBe(true);
    expect(reconciliationService.reconcile).toHaveBeenCalledTimes(1);
  });

  it('skips the pass when the advisory lock is held by another replica', async () => {
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: false }];
      return [];
    });

    await svc.runReconciliation();

    expect(reconciliationService.reconcile).not.toHaveBeenCalled();
  });

  it('swallows a reconciliation failure so the tick never crashes', async () => {
    (prisma.$queryRawUnsafe as any).mockImplementation(async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return [{ locked: true }];
      return [];
    });
    reconciliationService.reconcile.mockRejectedValueOnce(new Error('db blip'));

    await expect(svc.runReconciliation()).resolves.toBeUndefined();
  });
});
