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
// v2.8.88: BranchesController POST/PATCH/DELETE now gates on the
// MULTI_LOCATION feature via PlanFeatureGuard.
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
// Task 9 fix round 1: EscPosBuilderRegistry/Service moved out to their own
// small @Global() module (mirrors payments-core/fiscal-core) so a consumer
// that only needs the registry doesn't have to pull in this module's much
// larger graph. Re-exported below (as the whole module, not the bare
// tokens — see the exports comment) so existing consumers that reach the
// registry THROUGH DeviceMeshModule keep resolving unchanged.
import { PrintingCoreModule } from "../printing-core/printing-core.module";

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
    PrintingCoreModule,
  ],
  controllers: [DevicesController, BranchesController],
  providers: [
    DeviceService,
    BranchesService,
    DeviceTokenGuard,
    DeviceMeshScheduler,
  ],
  exports: [
    DeviceService,
    // Re-export the queue module so the 6 existing consumers that import
    // DeviceMeshModule for CommandQueueService keep resolving it unchanged.
    CommandQueueModule,
    BranchesService,
    DeviceTokenGuard,
    // Same re-export pattern as CommandQueueModule above: Nest only allows
    // exporting a token this module OWNS (declares in its own `providers`)
    // or a whole MODULE it imports — EscPosBuilderRegistry/Service now live
    // in PrintingCoreModule, so the module itself is what gets re-exported,
    // not the bare tokens (re-exporting is actually redundant with
    // PrintingCoreModule's own @Global() status, but kept explicit so a
    // standalone test that only imports DeviceMeshModule — not the whole
    // app graph — still resolves them, same "honest graph" posture as the
    // rest of this file).
    PrintingCoreModule,
  ],
})
export class DeviceMeshModule {}
