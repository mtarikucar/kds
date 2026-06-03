import { Module } from "@nestjs/common";
import { StockService } from "./stock.service";
import { StockController } from "./stock.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
  imports: [PrismaModule, SubscriptionsModule],
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
