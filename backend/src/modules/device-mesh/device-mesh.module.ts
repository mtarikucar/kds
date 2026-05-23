import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocalBridgeModule } from '../local-bridge/local-bridge.module';
import { DeviceService } from './device.service';
import { CommandQueueService } from './command-queue.service';
import { BranchesService } from './branches.service';
import { DevicesController } from './devices.controller';
import { BranchesController } from './branches.controller';
import { DeviceTokenGuard } from './device-token.guard';
import { DeviceMeshScheduler } from './device-mesh.scheduler';

/**
 * Device mesh module — registry, pairing, heartbeat, command queue.
 *
 * LocalBridgeModule is imported so the scheduler can sweep both device and
 * bridge staleness in one place; the bridge module also exports its service
 * for the marketplace's HummyBox SKU provisioning (Phase 5) and the
 * fiscal/payment modules' adapter routing (Phase 6/7).
 */
@Module({
  imports: [PrismaModule, LocalBridgeModule],
  controllers: [DevicesController, BranchesController],
  providers: [
    DeviceService,
    CommandQueueService,
    BranchesService,
    DeviceTokenGuard,
    DeviceMeshScheduler,
  ],
  exports: [DeviceService, CommandQueueService, BranchesService, DeviceTokenGuard],
})
export class DeviceMeshModule {}
