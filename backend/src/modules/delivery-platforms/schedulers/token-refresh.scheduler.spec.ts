import { TokenRefreshScheduler } from "./token-refresh.scheduler";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeliveryAuthService } from "../services/delivery-auth.service";

/**
 * Long-tail spec for the token-refresh cron. Load-bearing contracts:
 * the advisory lock gates the work across replicas (loser skips, winner
 * runs + unlocks), the in-process isRunning flag prevents overlapping
 * ticks, and a thrown refresh still releases the lock.
 */
describe("TokenRefreshScheduler", () => {
  function makePrisma(locked: boolean) {
    const calls: string[] = [];
    const $queryRawUnsafe = jest.fn((sql: string) => {
      calls.push(sql);
      if (sql.includes("pg_try_advisory_lock")) {
        return Promise.resolve([{ locked }]);
      }
      return Promise.resolve([]);
    });
    return {
      prisma: { $queryRawUnsafe } as unknown as PrismaService,
      calls,
    };
  }

  it("runs the refresh and unlocks when the advisory lock is acquired", async () => {
    const { prisma, calls } = makePrisma(true);
    const auth = {
      refreshExpiringTokens: jest.fn().mockResolvedValue(2),
    } as unknown as DeliveryAuthService;
    const sched = new TokenRefreshScheduler(prisma, auth);
    await sched.refreshTokens();
    expect(auth.refreshExpiringTokens).toHaveBeenCalled();
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
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

  it("releases the lock even if the refresh throws", async () => {
    const { prisma, calls } = makePrisma(true);
    const auth = {
      refreshExpiringTokens: jest.fn().mockRejectedValue(new Error("boom")),
    } as unknown as DeliveryAuthService;
    const sched = new TokenRefreshScheduler(prisma, auth);
    await sched.refreshTokens(); // swallowed + logged
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
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
