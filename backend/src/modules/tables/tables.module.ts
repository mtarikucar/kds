import { Module } from "@nestjs/common";
import { TablesService } from "./tables.service";
import { TablesController } from "./tables.controller";
import { FloorPlanService } from "./floor-plan.service";
import { FloorPlanController } from "./floor-plan.controller";
import { PrismaModule } from "../../prisma/prisma.module";
import { KdsModule } from "../kds/kds.module";
import { ReservationsModule } from "../reservations/reservations.module";

@Module({
  // ReservationsModule re-exports ReservationAvailabilityService, which owns
  // the shared public branch resolver (resolvePublicBranchId). The public
  // customer table listing routes through it so the branch a guest sees
  // matches the public reservation flow.
  imports: [PrismaModule, KdsModule, ReservationsModule],
  controllers: [TablesController, FloorPlanController],
  providers: [TablesService, FloorPlanService],
  exports: [TablesService, FloorPlanService],
})
export class TablesModule {}
