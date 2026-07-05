import { Module } from "@nestjs/common";
import { CommandQueueService } from "./command-queue.service";

/**
 * The per-device command queue as a standalone, leaf module.
 *
 * Extracted from DeviceMeshModule so BOTH the device-mesh (device-facing:
 * next-command/ack for self-polling devices) AND the local-bridge (bridge-facing:
 * the fan-in commands/next/ack) can consume the queue WITHOUT a circular module
 * dependency — DeviceMeshModule imports LocalBridgeModule (for the scheduler's
 * bridge-staleness sweep), so LocalBridgeModule importing DeviceMeshModule back
 * would form a cycle that crashes Nest bootstrap. Both now import THIS leaf.
 *
 * CommandQueueService's only dependencies (PrismaService, OutboxService,
 * ConfigService) are all @Global, so this module needs no imports.
 */
@Module({
  providers: [CommandQueueService],
  exports: [CommandQueueService],
})
export class CommandQueueModule {}
