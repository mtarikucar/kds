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
 * winner runs runOnce + unlocks), and the isRunning flag prevents an
 * overrunning tick from racing the next one (double-polling = double-billed
 * API quota).
 */
describe("OrderPollingScheduler", () => {
  function makeScheduler(locked: boolean) {
    const calls: string[] = [];
    const prisma = {
      $queryRawUnsafe: jest.fn((sql: string) => {
        calls.push(sql);
        if (sql.includes("pg_try_advisory_lock")) {
          return Promise.resolve([{ locked }]);
        }
        return Promise.resolve([]);
      }),
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

  it("runs once and unlocks when the lock is acquired", async () => {
    const { sched, calls, runOnce } = makeScheduler(true);
    await sched.pollOrders();
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(calls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
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
