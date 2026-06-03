import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../../prisma/prisma.service";
import { withAdvisoryLock } from "../../common/scheduling/advisory-lock";
import { DeviceService } from "./device.service";
import { CommandQueueService } from "./command-queue.service";
import { LocalBridgeService } from "../local-bridge/local-bridge.service";

/**
 * Periodic health sweeps for the mesh:
 *   - mark devices offline when heartbeats stop
 *   - mark bridges offline when heartbeats stop
 *   - requeue stuck inflight commands
 *
 * Crons run every minute — the work is index-friendly and the upper-bound on
 * stale-state detection (1m) matches operator expectations. Postgres
 * advisory lock (`device-mesh.sweep`) prevents duplicate work on multi-
 * replica deploys; sweeps are still idempotent so a lost lock is harmless.
 */
@Injectable()
export class DeviceMeshScheduler {
  private readonly logger = new Logger(DeviceMeshScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DeviceService,
    private readonly commands: CommandQueueService,
    private readonly bridges: LocalBridgeService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    await withAdvisoryLock(
      this.prisma,
      "device-mesh.sweep",
      async () => {
        try {
          const a = await this.devices.sweepStale();
          const b = await this.bridges.sweepStale();
          const c = await this.commands.sweepStuck();
          if (a + b + c > 0) {
            this.logger.log(
              `sweep: devicesOffline=${a} bridgesOffline=${b} commandsRequeued=${c}`,
            );
          }
        } catch (e) {
          this.logger.warn(`sweep failed: ${(e as Error).message}`);
        }
      },
      this.logger,
    );
  }
}
