import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LocalBridgeService } from "./local-bridge.service";
import { LocalBridgeController } from "./local-bridge.controller";
import { BridgeTokenGuard } from "./bridge-token.guard";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
// The bridge fan-in command loop (commands/next + ack) reuses the command queue.
// We import the leaf CommandQueueModule directly — NOT DeviceMeshModule — because
// DeviceMeshModule imports LocalBridgeModule (for the scheduler), so importing it
// back here would form a circular module dependency that crashes Nest bootstrap.
import { CommandQueueModule } from "../device-mesh/command-queue.module";

@Module({
  imports: [PrismaModule, SubscriptionsModule, CommandQueueModule],
  controllers: [LocalBridgeController],
  providers: [LocalBridgeService, BridgeTokenGuard],
  exports: [LocalBridgeService, BridgeTokenGuard],
})
export class LocalBridgeModule {}
