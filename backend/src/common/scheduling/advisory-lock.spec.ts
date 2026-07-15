import { Logger } from "@nestjs/common";
import { withAdvisoryLock } from "./advisory-lock";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Long-tail spec for the Postgres advisory-lock cron coordinator, v2
 * mechanism: ONE interactive transaction acquires pg_try_advisory_xact_lock
 * and holds it while run() executes — the lock releases at commit/rollback,
 * so there is NO unlock statement a pooled connection could misroute (the v1
 * leak: try_lock and unlock landed on different sessions → unlock no-op →
 * that job's cron never ran again).
 */
describe("withAdvisoryLock", () => {
  function makePrisma(locked: boolean) {
    const queryRawUnsafe = jest.fn((sql: string) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return Promise.resolve([{ locked }]);
      }
      return Promise.resolve([]);
    });
    const prisma: any = { $queryRawUnsafe: queryRawUnsafe };
    // The helper only touches tx.$queryRawUnsafe — hand it the same mock.
    prisma.$transaction = jest.fn(async (cb: any, _opts: any) => cb(prisma));
    return prisma as PrismaService & {
      $queryRawUnsafe: jest.Mock;
      $transaction: jest.Mock;
    };
  }

  it("runs the body inside the lock-holding transaction when acquired", async () => {
    const prisma = makePrisma(true);
    const run = jest.fn().mockResolvedValue(undefined);
    await withAdvisoryLock(prisma, "job-a", run);
    expect(run).toHaveBeenCalledTimes(1);
    // xact lock only — no unlock statement exists to misroute.
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain(
      "pg_try_advisory_xact_lock",
    );
  });

  it("skips the body and logs when the lock is held by another replica", async () => {
    const prisma = makePrisma(false);
    const run = jest.fn();
    const logger = { debug: jest.fn() } as unknown as Logger;
    await withAdvisoryLock(prisma, "job-b", run, logger);
    expect(run).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it("propagates a body throw (rollback still releases the xact lock)", async () => {
    const prisma = makePrisma(true);
    const run = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(withAdvisoryLock(prisma, "job-c", run)).rejects.toThrow(
      "boom",
    );
  });

  it("derives the same lock id for the same job name (stable hash)", async () => {
    const p1 = makePrisma(true);
    const p2 = makePrisma(true);
    await withAdvisoryLock(
      p1,
      "same-job",
      jest.fn().mockResolvedValue(undefined),
    );
    await withAdvisoryLock(
      p2,
      "same-job",
      jest.fn().mockResolvedValue(undefined),
    );
    const lockSql = (p: typeof p1) =>
      (p.$queryRawUnsafe as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((s: string) => s.includes("pg_try_advisory_xact_lock"));
    expect(lockSql(p1)).toBe(lockSql(p2));
  });

  it("holds the lock with generous transaction timeouts (expiry mid-run would re-open the duplicate-run window)", async () => {
    const prisma = makePrisma(true);
    await withAdvisoryLock(prisma, "job-t", async () => undefined);
    const opts = prisma.$transaction.mock.calls[0][1];
    expect(opts.timeout).toBe(30 * 60_000);
    expect(opts.maxWait).toBe(10_000);
  });
});
