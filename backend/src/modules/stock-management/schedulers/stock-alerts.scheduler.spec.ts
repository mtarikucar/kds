import { StockAlertsScheduler } from './stock-alerts.scheduler';

/**
 * Spec for the hourly StockAlertsScheduler. Covers the real control flow:
 *  - advisory lock not acquired → no tenant work, body never runs
 *  - lock acquired → checks each ACTIVE branch of each ACTIVE tenant,
 *    passing a branchId so the gateway emit fires
 *  - a failing branch is isolated (others still processed; no throw)
 *  - the djb2 lockId is deterministic + stable + matches the helper's hash
 *
 * The shared `withAdvisoryLock` helper now takes a TRANSACTION-scoped lock:
 * one interactive `prisma.$transaction(cb)` runs a single
 * `SELECT pg_try_advisory_xact_lock(<id>) AS locked` on the `tx` client and,
 * if won, awaits the body INSIDE the transaction. Postgres releases the lock
 * automatically on commit/rollback — there is no `pg_advisory_unlock` query.
 * The mock therefore wires `$transaction` to invoke the callback with
 * `tx === prisma`, so the existing `$queryRawUnsafe` stub drives the lock row.
 */
function makePrisma() {
  const prisma: any = {
    $queryRawUnsafe: jest.fn(),
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
  };
  // The interactive lock transaction runs its callback with tx === prisma, so
  // the single $queryRawUnsafe acquire stub below drives leader election. This
  // also transparently handles any inner $transaction the body might use.
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  return prisma;
}

describe('StockAlertsScheduler.runHourlyChecks', () => {
  it('does no tenant work when the advisory lock is not acquired', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: false }]);
    const alerts = { checkLowStock: jest.fn(), checkExpiringBatches: jest.fn() };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await sched.runHourlyChecks();

    expect(prisma.tenant.findMany).not.toHaveBeenCalled();
    expect(alerts.checkLowStock).not.toHaveBeenCalled();
    // Only the single try-lock SELECT ran; the xact lock needs no unlock query
    // and the loser never runs the body.
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe.mock.calls[0][0] as string).toMatch(
      /pg_try_advisory_xact_lock/,
    );
  });

  it('checks every ACTIVE branch of every ACTIVE tenant once the lock is acquired', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: true }]); // acquire
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', branches: [{ id: 'b1' }, { id: 'b2' }] },
      { id: 't2', branches: [{ id: 'b3' }] },
    ]);
    const alerts = {
      checkLowStock: jest.fn().mockResolvedValue(undefined),
      checkExpiringBatches: jest.fn().mockResolvedValue(undefined),
    };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await sched.runHourlyChecks();

    // 3 active branches total across the two tenants → one check pair each.
    expect(alerts.checkLowStock).toHaveBeenCalledTimes(3);
    expect(alerts.checkExpiringBatches).toHaveBeenCalledTimes(3);
    // The lock was acquired (the body ran) via the xact-lock SELECT; release is
    // automatic on commit, so the acquire is the only lock query issued.
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe.mock.calls[0][0] as string).toMatch(
      /pg_try_advisory_xact_lock/,
    );
  });

  // THE BUG FIX: the scheduled (branchId-less caller) run must pass a branchId
  // PER branch so the branch-suffixed gateway rooms actually receive the emit.
  it('passes a branchId per branch so the gateway emit can fire', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: true }]);
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', branches: [{ id: 'b1' }, { id: 'b2' }] },
    ]);
    const alerts = {
      checkLowStock: jest.fn().mockResolvedValue(undefined),
      checkExpiringBatches: jest.fn().mockResolvedValue(undefined),
    };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await sched.runHourlyChecks();

    // Each call carries the tenantId AND a concrete branchId — never the old
    // branchId-less form that silently skipped the emit.
    expect(alerts.checkLowStock).toHaveBeenCalledWith('t1', 'b1');
    expect(alerts.checkLowStock).toHaveBeenCalledWith('t1', 'b2');
    // checkExpiringBatches signature is (tenantId, days, branchId).
    expect(alerts.checkExpiringBatches).toHaveBeenCalledWith('t1', undefined, 'b1');
    expect(alerts.checkExpiringBatches).toHaveBeenCalledWith('t1', undefined, 'b2');
    // no call was made with a missing/undefined branchId
    for (const call of alerts.checkLowStock.mock.calls) {
      expect(call[1]).toBeTruthy();
    }
  });

  it('only queries ACTIVE branches (suspended/archived skipped at the DB)', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: true }]);
    prisma.tenant.findMany.mockResolvedValue([]);
    const sched = new StockAlertsScheduler(prisma as any, {
      checkLowStock: jest.fn(),
      checkExpiringBatches: jest.fn(),
    } as any);

    await sched.runHourlyChecks();

    const arg = prisma.tenant.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'ACTIVE' });
    expect(arg.select.branches.where).toEqual({ status: 'active' });
  });

  it('skips a tenant with no active branches without erroring', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: true }]);
    prisma.tenant.findMany.mockResolvedValue([{ id: 't1', branches: [] }]);
    const alerts = {
      checkLowStock: jest.fn().mockResolvedValue(undefined),
      checkExpiringBatches: jest.fn().mockResolvedValue(undefined),
    };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await expect(sched.runHourlyChecks()).resolves.toBeUndefined();
    expect(alerts.checkLowStock).not.toHaveBeenCalled();
    // The lock was acquired (the body ran the findMany) under the xact lock;
    // no unlock query is needed since release is automatic on commit.
    expect(prisma.$queryRawUnsafe.mock.calls[0][0] as string).toMatch(
      /pg_try_advisory_xact_lock/,
    );
  });

  it('isolates a failing branch so the others still run and it does not throw', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: true }]);
    prisma.tenant.findMany.mockResolvedValue([
      { id: 't1', branches: [{ id: 'bad' }, { id: 'good' }] },
    ]);
    const alerts = {
      checkLowStock: jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('boom'))) // branch "bad"
        .mockResolvedValue(undefined),
      checkExpiringBatches: jest.fn().mockResolvedValue(undefined),
    };
    const sched = new StockAlertsScheduler(prisma as any, alerts as any);

    await expect(sched.runHourlyChecks()).resolves.toBeUndefined();
    // "good" branch still processed despite "bad" throwing
    expect(alerts.checkLowStock).toHaveBeenCalledWith('t1', 'good');
    // The lock was acquired and held for the body; it releases automatically on
    // commit, so the acquire SELECT is the only lock query.
    expect(prisma.$queryRawUnsafe.mock.calls[0][0] as string).toMatch(
      /pg_try_advisory_xact_lock/,
    );
  });

  it('uses a deterministic, stable djb2 lockId for the acquire', async () => {
    const prisma = makePrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ locked: true }]);
    prisma.tenant.findMany.mockResolvedValue([]);
    const sched = new StockAlertsScheduler(prisma as any, {
      checkLowStock: jest.fn(),
      checkExpiringBatches: jest.fn(),
    } as any);

    await sched.runHourlyChecks();

    const acquireSql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    const acquireId = acquireSql.match(
      /pg_try_advisory_xact_lock\((-?\d+)\)/,
    )![1];
    // djb2("stock-alerts") is a stable 32-bit value — assert the exact hash so
    // an accidental change to the algorithm is caught.
    expect(Number(acquireId)).toBe(djb2('stock-alerts'));
  });
});

/** Mirror of the helper's djb2 so the spec pins the exact lock id. */
function djb2(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i += 1) {
    hash = ((hash << 5) + hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}
