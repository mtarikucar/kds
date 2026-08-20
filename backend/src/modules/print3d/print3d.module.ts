import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { Print3dService } from "./print3d.service";
import { Print3dController } from "./print3d.controller";
import { SuperadminPrint3dController } from "./superadmin-print3d.controller";

@Module({
  imports: [PrismaModule],
  controllers: [Print3dController, SuperadminPrint3dController],
  providers: [Print3dService],
  exports: [Print3dService],
})
export class Print3dModule {}
