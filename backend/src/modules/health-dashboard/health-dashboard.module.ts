import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { HealthDashboardService } from "./health-dashboard.service";
import { HealthDashboardController } from "./health-dashboard.controller";

@Module({
  imports: [PrismaModule],
  controllers: [HealthDashboardController],
  providers: [HealthDashboardService],
  exports: [HealthDashboardService],
})
export class HealthDashboardModule {}
