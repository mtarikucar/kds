import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LocalBridgeService } from "./local-bridge.service";
import { LocalBridgeController } from "./local-bridge.controller";
import { BridgeTokenGuard } from "./bridge-token.guard";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
// The bridge fan-in command loop (commands/next + ack) reuses the device-mesh
// command queue; CommandQueueService is exported by DeviceMeshModule.
import { DeviceMeshModule } from "../device-mesh/device-mesh.module";

@Module({
  imports: [PrismaModule, SubscriptionsModule, DeviceMeshModule],
  controllers: [LocalBridgeController],
  providers: [LocalBridgeService, BridgeTokenGuard],
  exports: [LocalBridgeService, BridgeTokenGuard],
})
export class LocalBridgeModule {}
