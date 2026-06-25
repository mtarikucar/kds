import { DeviceMeshScheduler } from "./device-mesh.scheduler";
import { PrismaService } from "../../prisma/prisma.service";
import { DeviceService } from "./device.service";
import { CommandQueueService } from "./command-queue.service";
import { LocalBridgeService } from "../local-bridge/local-bridge.service";

/**
 * Long-tail spec for the device-mesh sweep cron. Load-bearing contracts:
 * under the advisory lock it runs all three idempotent sweeps (devices /
 * bridges / stuck commands), and a thrown sub-sweep is swallowed (a single
 * failing sweep must not abort the others' next tick or crash the cron).
 */
describe("DeviceMeshScheduler.sweep", () => {
  function makePrismaWithLock() {
    const prisma = {
      $queryRawUnsafe: jest.fn((sql: string) =>
        sql.includes("pg_try_advisory")
          ? Promise.resolve([{ locked: true }])
          : Promise.resolve([]),
      ),
      // New advisory-lock contract: the helper takes a transaction-scoped
      // lock inside an interactive $transaction and runs the body with the
      // tx client. Run the callback with `tx === prisma` so the existing
      // $queryRawUnsafe lock stub (matching "pg_try_advisory") drives the
      // winner path for the new pg_try_advisory_xact_lock query.
      $transaction: jest.fn((cb: any) => cb(prisma)),
    } as unknown as PrismaService;
    return prisma;
  }

  it("runs all three sweeps when the advisory lock is held", async () => {
    const devices = { sweepStale: jest.fn().mockResolvedValue(1) } as unknown as DeviceService;
    const bridges = { sweepStale: jest.fn().mockResolvedValue(0) } as unknown as LocalBridgeService;
    const commands = { sweepStuck: jest.fn().mockResolvedValue(2) } as unknown as CommandQueueService;
    const sched = new DeviceMeshScheduler(
      makePrismaWithLock(),
      devices,
      commands,
      bridges,
    );
    await sched.sweep();
    expect(devices.sweepStale).toHaveBeenCalled();
    expect(bridges.sweepStale).toHaveBeenCalled();
    expect(commands.sweepStuck).toHaveBeenCalled();
  });

  it("swallows a sub-sweep error (cron must not crash)", async () => {
    const devices = {
      sweepStale: jest.fn().mockRejectedValue(new Error("db blip")),
    } as unknown as DeviceService;
    const bridges = { sweepStale: jest.fn().mockResolvedValue(0) } as unknown as LocalBridgeService;
    const commands = { sweepStuck: jest.fn().mockResolvedValue(0) } as unknown as CommandQueueService;
    const sched = new DeviceMeshScheduler(
      makePrismaWithLock(),
      devices,
      commands,
      bridges,
    );
    await expect(sched.sweep()).resolves.toBeUndefined();
  });

  it("skips the sweeps when another replica holds the lock", async () => {
    const queryRawUnsafe = jest.fn(() => Promise.resolve([{ locked: false }]));
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
      $transaction: jest.fn((cb: any) => cb(prisma)),
    } as unknown as PrismaService;
    const devices = { sweepStale: jest.fn() } as unknown as DeviceService;
    const sched = new DeviceMeshScheduler(
      prisma,
      devices,
      { sweepStuck: jest.fn() } as unknown as CommandQueueService,
      { sweepStale: jest.fn() } as unknown as LocalBridgeService,
    );
    await sched.sweep();
    // Lock query WAS issued (acquisition attempted) but returned not-locked,
    // so the loser skips the body. Release is automatic on tx end — no
    // pg_advisory_unlock query exists to assert anymore.
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_try_advisory_xact_lock"),
    );
    expect(devices.sweepStale).not.toHaveBeenCalled();
  });
});
