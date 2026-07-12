import { AnalyticsScheduler } from './analytics.scheduler';

/**
 * Spec for the nightly AnalyticsScheduler. Covers the real control flow:
 *  - advisory lock not acquired → no tenant work, no unlock
 *  - lock acquired → generateInsights per ACTIVE branch of each ACTIVE
 *    tenant + archiveExpiredInsights per tenant, then releases the lock
 *  - a failing branch/tenant is isolated (others still processed; no throw)
 *  - re-entrancy guard (isRunning) skips overlapping runs
 */
function makePrisma() {
  return {
    $queryRawUnsafe: jest.fn(),
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function makeInsights() {
  return {
    generateInsights: jest.fn().mockResolvedValue(0),
    archiveExpiredInsights: jest.fn().mockResolvedValue(0),
  };
}

describe('AnalyticsScheduler.handleDailyInsights', () => {
  it('does no tenant work and does not unlock when the advisory lock is not acquired', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: false }]);
    const insights = makeInsights();
    const sched = new AnalyticsScheduler(prisma as any, insights as any);

    await sched.handleDailyInsights();

    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    expect(insights.generateInsights).not.toHaveBeenCalled();
    expect(insights.archiveExpiredInsights).not.toHaveBeenCalled();
    // only the try-lock SELECT ran (no unlock) since the lock wasn't held
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it('generates insights per ACTIVE branch and archives per tenant, then releases the lock', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }]) // acquire
      .mockResolvedValueOnce([{}]); // unlock
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', branches: [{ id: 'b1' }, { id: 'b2' }] },
      { id: 't2', branches: [{ id: 'b3' }] },
    ]);
    const insights = makeInsights();
    const sched = new AnalyticsScheduler(prisma as any, insights as any);

    await sched.handleDailyInsights();

    // generateInsights signature is (tenantId, branchId) — one call per branch
    expect(insights.generateInsights).toHaveBeenCalledTimes(3);
    expect(insights.generateInsights).toHaveBeenCalledWith('t1', 'b1');
    expect(insights.generateInsights).toHaveBeenCalledWith('t1', 'b2');
    expect(insights.generateInsights).toHaveBeenCalledWith('t2', 'b3');
    // archive is tenant-wide — one call per tenant
    expect(insights.archiveExpiredInsights).toHaveBeenCalledTimes(2);
    expect(insights.archiveExpiredInsights).toHaveBeenCalledWith('t1');
    expect(insights.archiveExpiredInsights).toHaveBeenCalledWith('t2');
    // last query is the advisory unlock
    const lastCall = prisma.$queryRawUnsafe.mock.calls.at(-1)![0] as string;
    expect(lastCall).toMatch(/pg_advisory_unlock/);
  });

  it('only loads ACTIVE tenants and their ACTIVE branches', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    const sched = new AnalyticsScheduler(prisma as any, makeInsights() as any);

    await sched.handleDailyInsights();

    const arg = prisma.tenant.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'ACTIVE' });
    expect(arg.select.branches.where).toEqual({ status: 'active' });
  });

  it('isolates a failing branch so the other branches + the archive still run, without throwing', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', branches: [{ id: 'bad' }, { id: 'good' }] },
    ]);
    const insights = makeInsights();
    insights.generateInsights
      .mockImplementationOnce(() => Promise.reject(new Error('boom'))) // branch "bad"
      .mockResolvedValue(0);
    const sched = new AnalyticsScheduler(prisma as any, insights as any);

    await expect(sched.handleDailyInsights()).resolves.toBeUndefined();
    expect(insights.generateInsights).toHaveBeenCalledWith('t1', 'good');
    expect(insights.archiveExpiredInsights).toHaveBeenCalledWith('t1');
    // lock still released in finally
    expect(prisma.$queryRawUnsafe.mock.calls.at(-1)![0] as string).toMatch(
      /pg_advisory_unlock/,
    );
  });

  it('isolates a failing archive so the next tenant is still processed', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', branches: [] },
      { id: 't2', branches: [{ id: 'b2' }] },
    ]);
    const insights = makeInsights();
    insights.archiveExpiredInsights
      .mockImplementationOnce(() => Promise.reject(new Error('archive boom')))
      .mockResolvedValue(0);
    const sched = new AnalyticsScheduler(prisma as any, insights as any);

    await expect(sched.handleDailyInsights()).resolves.toBeUndefined();
    expect(insights.generateInsights).toHaveBeenCalledWith('t2', 'b2');
    expect(insights.archiveExpiredInsights).toHaveBeenCalledWith('t2');
  });

  it('uses a deterministic, stable lockId for both acquire and release', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{}]);
    const sched = new AnalyticsScheduler(prisma as any, makeInsights() as any);

    await sched.handleDailyInsights();

    const acquireSql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    const releaseSql = prisma.$queryRawUnsafe.mock.calls[1][0] as string;
    const acquireId = acquireSql.match(/pg_try_advisory_lock\((-?\d+)\)/)![1];
    const releaseId = releaseSql.match(/pg_advisory_unlock\((-?\d+)\)/)![1];
    expect(acquireId).toBe(releaseId);
    expect(Number(acquireId)).toBe((sched as any).lockId('analytics-insights'));
  });

  it('skips overlapping runs via the isRunning re-entrancy guard', async () => {
    const prisma = makePrisma();
    let releaseLockQuery: (v: any) => void;
    prisma.$queryRawUnsafe.mockImplementationOnce(
      () => new Promise((resolve) => (releaseLockQuery = resolve)),
    );
    const insights = makeInsights();
    const sched = new AnalyticsScheduler(prisma as any, insights as any);

    const first = sched.handleDailyInsights(); // parks on the try-lock query
    await sched.handleDailyInsights(); // overlapping call → guard returns

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);

    releaseLockQuery!([{ locked: false }]);
    await first;
  });
});
