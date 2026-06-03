import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { LocalBridgeService } from "./local-bridge.service";
import { LocalBridgeController } from "./local-bridge.controller";
import { BridgeTokenGuard } from "./bridge-token.guard";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [LocalBridgeController],
  providers: [LocalBridgeService, BridgeTokenGuard],
  exports: [LocalBridgeService, BridgeTokenGuard],
})
export class LocalBridgeModule {}
