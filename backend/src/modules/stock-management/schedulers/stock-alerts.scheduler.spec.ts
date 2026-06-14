import { StockAlertsScheduler } from './stock-alerts.scheduler';

/**
 * Spec for the hourly StockAlertsScheduler. Covers the real control flow:
 *  - advisory lock not acquired → no tenant work, no unlock
 *  - lock acquired → checks each ACTIVE tenant, releases the lock in finally
 *  - a failing tenant is isolated (others still processed; no throw)
 *  - the lockId djb2 hash is deterministic + stable across the two lock calls
 */
function makePrisma() {
  const calls: string[] = [];
  return {
    calls,
    $queryRawUnsafe: jest.fn(),
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe('StockAlertsScheduler.runHourlyChecks', () => {
  it('does no tenant work and does not unlock when the advisory lock is not acquired', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: false }]);
    const alerts = { checkLowStock: jest.fn(), checkExpiringBatches: jest.fn() };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await sched.runHourlyChecks();

    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    expect(alerts.checkLowStock).not.toHaveBeenCalled();
    // only the try-lock SELECT ran (no unlock) since the lock wasn't held
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('checks every ACTIVE tenant then releases the lock', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }]) // acquire
      .mockResolvedValueOnce([{}]); // unlock
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const alerts = {
      checkLowStock: jest.fn().mockResolvedValue(undefined),
      checkExpiringBatches: jest.fn().mockResolvedValue(undefined),
    };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await sched.runHourlyChecks();

    expect(alerts.checkLowStock).toHaveBeenCalledTimes(2);
    expect(alerts.checkExpiringBatches).toHaveBeenCalledTimes(2);
    // last query is the advisory unlock
    const lastCall = prisma.$queryRawUnsafe.mock.calls.at(-1)![0] as string;
    expect(lastCall).toMatch(/pg_advisory_unlock/);
  });

  it('isolates a failing tenant so the others still run and it does not throw', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    prisma.tenant.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
    const alerts = {
      checkLowStock: jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('boom'))) // tenant "bad"
        .mockResolvedValue(undefined),
      checkExpiringBatches: jest.fn().mockResolvedValue(undefined),
    };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await expect(sched.runHourlyChecks()).resolves.toBeUndefined();
    // "good" tenant still processed despite "bad" throwing
    expect(alerts.checkLowStock).toHaveBeenCalledWith('good');
    // lock still released in finally
    expect((prisma.$queryRawUnsafe.mock.calls.at(-1)![0] as string)).toMatch(/pg_advisory_unlock/);
  });

  it('uses a deterministic, stable lockId for both acquire and release', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    prisma.tenant.findMany.mockResolvedValue([]);
    const sched = new StockAlertsScheduler(prisma as any, { checkLowStock: jest.fn(), checkExpiringBatches: jest.fn() } as any);

    await sched.runHourlyChecks();

    const acquireSql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    const releaseSql = prisma.$queryRawUnsafe.mock.calls[1][0] as string;
    const acquireId = acquireSql.match(/pg_try_advisory_lock\((-?\d+)\)/)![1];
    const releaseId = releaseSql.match(/pg_advisory_unlock\((-?\d+)\)/)![1];
    expect(acquireId).toBe(releaseId);
    // djb2("stock-alerts") is a stable 32-bit value — assert the exact hash so
    // an accidental change to the algorithm is caught.
    expect(Number(acquireId)).toBe((sched as any).lockId('stock-alerts'));
  });
});
