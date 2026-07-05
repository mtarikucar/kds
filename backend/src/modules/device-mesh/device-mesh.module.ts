import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LocalBridgeModule } from "../local-bridge/local-bridge.module";
import { DeviceService } from "./device.service";
import { CommandQueueModule } from "./command-queue.module";
import { BranchesService } from "./branches.service";
import { DevicesController } from "./devices.controller";
import { BranchesController } from "./branches.controller";
import { DeviceTokenGuard } from "./device-token.guard";
import { DeviceMeshScheduler } from "./device-mesh.scheduler";
import { EscPosBuilderRegistry } from "./printing/escpos-builder.registry";
import { EscPosBuilderService } from "./printing/escpos-builder.service";
// v2.8.88: BranchesController POST/PATCH/DELETE now gates on the
// MULTI_LOCATION feature via PlanFeatureGuard.
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

/**
 * Device mesh module — registry, pairing, heartbeat, command queue.
 *
 * LocalBridgeModule is imported so the scheduler can sweep both device and
 * bridge staleness in one place; the bridge module also exports its service
 * for the marketplace's HummyBox SKU provisioning (Phase 5) and the
 * fiscal/payment modules' adapter routing (Phase 6/7).
 */
@Module({
  // CommandQueueModule is a leaf providing CommandQueueService; importing +
  // re-exporting it (instead of declaring the service here) lets LocalBridgeModule
  // consume the queue without importing DeviceMeshModule back (which would form a
  // bootstrap-crashing cycle, since we import LocalBridgeModule for the scheduler).
  imports: [
    PrismaModule,
    CommandQueueModule,
    LocalBridgeModule,
    SubscriptionsModule,
  ],
  controllers: [DevicesController, BranchesController],
  providers: [
    DeviceService,
    BranchesService,
    DeviceTokenGuard,
    DeviceMeshScheduler,
    EscPosBuilderRegistry,
    EscPosBuilderService,
  ],
  exports: [
    DeviceService,
    // Re-export the queue module so the 6 existing consumers that import
    // DeviceMeshModule for CommandQueueService keep resolving it unchanged.
    CommandQueueModule,
    BranchesService,
    DeviceTokenGuard,
    EscPosBuilderRegistry,
    EscPosBuilderService,
  ],
})
export class DeviceMeshModule {}
