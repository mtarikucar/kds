import { OrderPollingScheduler } from "./order-polling.scheduler";
import { PrismaService } from "../../../prisma/prisma.service";
import { AdapterFactory } from "../adapters/adapter-factory";
import { DeliveryOrderService } from "../services/delivery-order.service";
import { DeliveryAuthService } from "../services/delivery-auth.service";
import { DeliveryConfigService } from "../services/delivery-config.service";
import { DeliveryLogService } from "../services/delivery-log.service";

/**
 * Long-tail spec for the order-polling cron's coordination shell. Load-
 * bearing contracts: advisory lock gates work across replicas (loser skips,
 * winner runs runOnce), and the isRunning flag prevents an overrunning tick
 * from racing the next one (double-polling = double-billed API quota).
 *
 * The advisory lock is now a transaction-scoped `pg_try_advisory_xact_lock`
 * taken inside a single interactive `$transaction`; release is automatic on
 * commit/rollback (no `pg_advisory_unlock` query anymore). The $transaction
 * mock below runs the interactive callback with `tx === prisma`, so the
 * `$queryRawUnsafe` lock stub (matching the "pg_try_advisory_lock" substring,
 * which the new "pg_try_advisory_xact_lock" SQL still contains) drives it.
 */
describe("OrderPollingScheduler", () => {
  function makeScheduler(locked: boolean) {
    const calls: string[] = [];
    const prisma = {
      $queryRawUnsafe: jest.fn((sql: string) => {
        calls.push(sql);
        // The lock query is now `pg_try_advisory_xact_lock` (transaction-
        // scoped). Match on the shared `pg_try_advisory` prefix so this stub
        // drives both the lock acquire and (legacy) variants.
        if (sql.includes("pg_try_advisory")) {
          return Promise.resolve([{ locked }]);
        }
        return Promise.resolve([]);
      }),
      // The new helper takes the lock inside ONE interactive transaction and
      // relies on automatic release on commit/rollback. Run the callback with
      // `tx === prisma` so the lock stub above drives it (and so any inner
      // service `$transaction` work runs too).
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    } as unknown as PrismaService;
    const sched = new OrderPollingScheduler(
      prisma,
      {} as AdapterFactory,
      {} as DeliveryOrderService,
      {} as DeliveryAuthService,
      {} as DeliveryConfigService,
      {} as DeliveryLogService,
    );
    const runOnce = jest
      .spyOn(sched as any, "runOnce")
      .mockResolvedValue(undefined);
    return { sched, calls, runOnce };
  }

  it("runs once when the transaction-scoped lock is acquired (auto-released on commit)", async () => {
    const { sched, calls, runOnce } = makeScheduler(true);
    await sched.pollOrders();
    expect(runOnce).toHaveBeenCalledTimes(1);
    // The lock is taken via a single transaction-scoped query and released
    // automatically on commit — assert it was ACQUIRED (the xact-lock query
    // was issued) and that NO manual unlock query is emitted anymore.
    expect(calls.some((s) => s.includes("pg_try_advisory_xact_lock"))).toBe(
      true,
    );
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(false);
  });

  it("skips runOnce when another replica holds the lock", async () => {
    const { sched, runOnce } = makeScheduler(false);
    await sched.pollOrders();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it("skips a re-entrant tick while one is in flight", async () => {
    const { sched, runOnce } = makeScheduler(true);
    (sched as unknown as { isRunning: boolean }).isRunning = true;
    await sched.pollOrders();
    expect(runOnce).not.toHaveBeenCalled();
  });
});
