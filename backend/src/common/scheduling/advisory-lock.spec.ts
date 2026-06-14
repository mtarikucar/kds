import { Logger } from "@nestjs/common";
import { withAdvisoryLock } from "./advisory-lock";
import { PrismaService } from "../../prisma/prisma.service";

/**
 * Long-tail spec for the Postgres advisory-lock cron coordinator. Load-
 * bearing contracts: the winning replica (lock acquired) runs the body and
 * always unlocks afterwards; a losing replica (lock held elsewhere) skips
 * the body entirely; the unlock still fires if the body throws.
 */
describe("withAdvisoryLock", () => {
  function makePrisma(locked: boolean) {
    const queryRawUnsafe = jest.fn((sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) {
        return Promise.resolve([{ locked }]);
      }
      return Promise.resolve([]);
    });
    return { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaService & {
      $queryRawUnsafe: jest.Mock;
    };
  }

  it("runs the body and unlocks when the lock is acquired", async () => {
    const prisma = makePrisma(true);
    const run = jest.fn().mockResolvedValue(undefined);
    await withAdvisoryLock(prisma, "job-a", run);
    expect(run).toHaveBeenCalledTimes(1);
    const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(calls.some((s: string) => s.includes("pg_advisory_unlock"))).toBe(
      true,
    );
  });

  it("skips the body and logs when the lock is held by another replica", async () => {
    const prisma = makePrisma(false);
    const run = jest.fn();
    const logger = { debug: jest.fn() } as unknown as Logger;
    await withAdvisoryLock(prisma, "job-b", run, logger);
    expect(run).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalled();
    // never reaches the unlock statement
    const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(calls.some((s: string) => s.includes("pg_advisory_unlock"))).toBe(
      false,
    );
  });

  it("releases the lock even when the body throws", async () => {
    const prisma = makePrisma(true);
    const run = jest.fn().mockRejectedValue(new Error("boom"));
    await expect(withAdvisoryLock(prisma, "job-c", run)).rejects.toThrow(
      "boom",
    );
    const calls = (prisma.$queryRawUnsafe as jest.Mock).mock.calls.map(
      (c) => c[0],
    );
    expect(calls.some((s: string) => s.includes("pg_advisory_unlock"))).toBe(
      true,
    );
  });

  it("derives the same lock id for the same job name (stable hash)", async () => {
    const p1 = makePrisma(true);
    const p2 = makePrisma(true);
    await withAdvisoryLock(p1, "same-job", jest.fn().mockResolvedValue(undefined));
    await withAdvisoryLock(p2, "same-job", jest.fn().mockResolvedValue(undefined));
    const lockSql = (p: typeof p1) =>
      (p.$queryRawUnsafe as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((s: string) => s.includes("pg_try_advisory_lock"));
    expect(lockSql(p1)).toBe(lockSql(p2));
  });
});
