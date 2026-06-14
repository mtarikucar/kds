import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { CallerService } from "./caller.service";
import { CallerController } from "./caller.controller";
import { MockCallerProvider } from "./adapters/mock-caller.provider";
import { CallerProviderRegistry } from "./caller-provider.registry";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [CallerController],
  providers: [CallerService, MockCallerProvider, CallerProviderRegistry],
  exports: [CallerService],
})
export class CallerModule {}
