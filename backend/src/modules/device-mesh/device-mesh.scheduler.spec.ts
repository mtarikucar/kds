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
    return {
      $queryRawUnsafe: jest.fn((sql: string) =>
        sql.includes("pg_try_advisory_lock")
          ? Promise.resolve([{ locked: true }])
          : Promise.resolve([]),
      ),
    } as unknown as PrismaService;
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
    const prisma = {
      $queryRawUnsafe: jest.fn(() => Promise.resolve([{ locked: false }])),
    } as unknown as PrismaService;
    const devices = { sweepStale: jest.fn() } as unknown as DeviceService;
    const sched = new DeviceMeshScheduler(
      prisma,
      devices,
      { sweepStuck: jest.fn() } as unknown as CommandQueueService,
      { sweepStale: jest.fn() } as unknown as LocalBridgeService,
    );
    await sched.sweep();
    expect(devices.sweepStale).not.toHaveBeenCalled();
  });
});
