import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DeviceService } from './device.service';
import { CommandQueueService } from './command-queue.service';
import { LocalBridgeService } from '../local-bridge/local-bridge.service';

/**
 * Periodic health sweeps for the mesh:
 *   - mark devices offline when heartbeats stop
 *   - mark bridges offline when heartbeats stop
 *   - requeue stuck inflight commands
 *
 * Crons run every minute — the work is index-friendly and the upper-bound on
 * stale-state detection (1m) matches operator expectations. Distributed-lock
 * coordination is the existing project pattern but not yet applied here;
 * sweep idempotency means a duplicate run is harmless.
 */
@Injectable()
export class DeviceMeshScheduler {
  private readonly logger = new Logger(DeviceMeshScheduler.name);

  constructor(
    private readonly devices: DeviceService,
    private readonly commands: CommandQueueService,
    private readonly bridges: LocalBridgeService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    try {
      const a = await this.devices.sweepStale();
      const b = await this.bridges.sweepStale();
      const c = await this.commands.sweepStuck();
      if (a + b + c > 0) {
        this.logger.log(`sweep: devicesOffline=${a} bridgesOffline=${b} commandsRequeued=${c}`);
      }
    } catch (e) {
      this.logger.warn(`sweep failed: ${(e as Error).message}`);
    }
  }
}
