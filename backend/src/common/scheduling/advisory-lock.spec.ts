import { Logger } from "@nestjs/common";
import { withAdvisoryLock } from "./advisory-lock";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Long-tail spec for the Postgres advisory-lock cron coordinator. Load-
 * bearing contracts after the transaction-scoped rewrite:
 *  - acquire + run + release all happen inside ONE interactive
 *    `$transaction` (so the lock is taken and released on the SAME pooled
 *    connection — the bug fix);
 *  - the lock is a TRANSACTION-scoped `pg_try_advisory_xact_lock` (released
 *    automatically on commit/rollback — there is no manual `pg_advisory_unlock`
 *    that could land on a different connection and leak the lock);
 *  - the winning replica (lock acquired) runs the body; a losing replica
 *    (lock held elsewhere) skips the body and logs;
 *  - a throwing body propagates the error (Postgres rolls back → releases).
 */
describe("withAdvisoryLock", () => {
  function makePrisma(locked: boolean) {
    const queryRawUnsafe = jest.fn((sql: string) => {
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return Promise.resolve([{ locked }]);
      }
      return Promise.resolve([]);
    });
    // The tx client handed to the callback exposes the same raw-query API.
    const tx = { $queryRawUnsafe: queryRawUnsafe };
    const $transaction = jest.fn(
      async (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
    );
    return {
      $transaction,
      // surfaced for assertions
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaService & {
      $transaction: jest.Mock;
      $queryRawUnsafe: jest.Mock;
    };
  }

  function lockCalls(prisma: { $queryRawUnsafe: jest.Mock }): string[] {
    return prisma.$queryRawUnsafe.mock.calls.map((c) => c[0] as string);
  }

  it("runs the body inside a single transaction when the lock is acquired", async () => {
    const prisma = makePrisma(true);
    const run = jest.fn().mockResolvedValue(undefined);
    await withAdvisoryLock(prisma, "job-a", run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const calls = lockCalls(prisma);
    expect(
      calls.some((s) => s.includes("pg_try_advisory_xact_lock")),
    ).toBe(true);
    // No manual unlock — the xact-scoped lock auto-releases on commit.
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(false);
  });

  it("skips the body and logs when the lock is held by another replica", async () => {
    const prisma = makePrisma(false);
    const run = jest.fn();
    const logger = { debug: jest.fn() } as unknown as Logger;
    await withAdvisoryLock(prisma, "job-b", run, logger);
    expect(run).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
  });

  it("propagates the error when the body throws (Postgres rolls back → releases)", async () => {
    const prisma = makePrisma(true);
    const run = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(withAdvisoryLock(prisma, "job-c", run)).rejects.toThrow(
      "boom",
    );
    // Still no manual unlock path — release is the transaction's job.
    expect(lockCalls(prisma).some((s) => s.includes("pg_advisory_unlock"))).toBe(
      false,
    );
  });

  it("passes a bounded transaction timeout (no unbounded lock hold)", async () => {
    const prisma = makePrisma(true);
    await withAdvisoryLock(prisma, "job-t", jest.fn().mockResolvedValue(undefined));
    const opts = prisma.$transaction.mock.calls[0][1] as {
      timeout?: number;
      maxWait?: number;
    };
    expect(opts).toBeDefined();
    expect(typeof opts.timeout).toBe("number");
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it("derives the same lock id for the same job name (stable hash)", async () => {
    const p1 = makePrisma(true);
    const p2 = makePrisma(true);
    await withAdvisoryLock(p1, "same-job", jest.fn().mockResolvedValue(undefined));
    await withAdvisoryLock(p2, "same-job", jest.fn().mockResolvedValue(undefined));
    const lockSql = (p: { $queryRawUnsafe: jest.Mock }) =>
      lockCalls(p).find((s) => s.includes("pg_try_advisory_xact_lock"));
    expect(lockSql(p1)).toBe(lockSql(p2));
  });
});
