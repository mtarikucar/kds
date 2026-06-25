import { TokenRefreshScheduler } from "./token-refresh.scheduler";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeliveryAuthService } from "../services/delivery-auth.service";

/**
 * Long-tail spec for the token-refresh cron. Load-bearing contracts:
 * the advisory lock gates the work across replicas (loser skips, winner
 * runs the body), the in-process isRunning flag prevents overlapping
 * ticks, and a thrown refresh is swallowed.
 *
 * The lock is now a transaction-scoped `pg_try_advisory_xact_lock` taken
 * inside a single interactive `prisma.$transaction` — released
 * AUTOMATICALLY by Postgres on commit/rollback (no `pg_advisory_unlock`
 * query). The $transaction mock runs the callback with `tx === prisma`,
 * so the `$queryRawUnsafe` lock stub (matching the substring
 * "pg_try_advisory_xact_lock") drives the winner/loser decision.
 */
describe("TokenRefreshScheduler", () => {
  function makePrisma(locked: boolean) {
    const calls: string[] = [];
    const $queryRawUnsafe = jest.fn((sql: string) => {
      calls.push(sql);
      // New mechanism: transaction-scoped `pg_try_advisory_xact_lock`.
      if (sql.includes("pg_try_advisory_xact_lock")) {
        return Promise.resolve([{ locked }]);
      }
      return Promise.resolve([]);
    });
    const prisma = { $queryRawUnsafe } as Record<string, unknown>;
    prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(prisma)),
    );
    return {
      prisma: prisma as unknown as PrismaService,
      calls,
    };
  }

  it("acquires the xact lock and runs the refresh when the lock is free", async () => {
    const { prisma, calls } = makePrisma(true);
    const auth = {
      refreshExpiringTokens: jest.fn().mockResolvedValue(2),
    } as unknown as DeliveryAuthService;
    const sched = new TokenRefreshScheduler(prisma, auth);
    await sched.refreshTokens();
    // Winner: lock query issued and the body ran.
    expect(calls.some((s) => s.includes("pg_try_advisory_xact_lock"))).toBe(
      true,
    );
    expect(auth.refreshExpiringTokens).toHaveBeenCalled();
    // Release is automatic on commit — no explicit unlock query is issued.
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(false);
  });

  it("skips the work when another replica holds the lock", async () => {
    const { prisma } = makePrisma(false);
    const auth = {
      refreshExpiringTokens: jest.fn(),
    } as unknown as DeliveryAuthService;
    const sched = new TokenRefreshScheduler(prisma, auth);
    await sched.refreshTokens();
    expect(auth.refreshExpiringTokens).not.toHaveBeenCalled();
  });

  it("acquires the lock and swallows a thrown refresh (lock auto-released)", async () => {
    const { prisma, calls } = makePrisma(true);
    const auth = {
      refreshExpiringTokens: jest.fn().mockRejectedValue(new Error("boom")),
    } as unknown as DeliveryAuthService;
    const sched = new TokenRefreshScheduler(prisma, auth);
    await sched.refreshTokens(); // swallowed + logged
    // Winner acquired the lock and attempted the refresh.
    expect(calls.some((s) => s.includes("pg_try_advisory_xact_lock"))).toBe(
      true,
    );
    expect(auth.refreshExpiringTokens).toHaveBeenCalled();
    // The xact-scoped lock is released by the transaction rollback — no
    // explicit unlock query is ever issued.
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(false);
  });

  it("skips a re-entrant tick while one is already running", async () => {
    const { prisma } = makePrisma(true);
    const auth = {
      refreshExpiringTokens: jest.fn(),
    } as unknown as DeliveryAuthService;
    const sched = new TokenRefreshScheduler(prisma, auth);
    (sched as unknown as { isRunning: boolean }).isRunning = true;
    await sched.refreshTokens();
    expect(auth.refreshExpiringTokens).not.toHaveBeenCalled();
  });
});
