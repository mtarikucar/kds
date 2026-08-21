import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SuperAdminModule } from "../superadmin/superadmin.module";
import { Print3dService } from "./print3d.service";
import { Print3dController } from "./print3d.controller";
import { SuperadminPrint3dController } from "./superadmin-print3d.controller";

@Module({
  // SuperAdminModule re-exports JwtModule (configured with the superadmin
  // JWT secret) specifically so importers can guard a controller with
  // SuperAdminGuard without redeclaring JwtModule themselves — see its
  // `exports` comment. SuperadminPrint3dController uses that guard; without
  // this import Nest fails DI resolution at boot ("Nest can't resolve
  // dependencies of the SuperAdminGuard ... JwtService ... not available in
  // the Print3dModule context"), which crashes app startup entirely, not
  // just this route. Same pattern as catalog.module.ts / fulfillment.module.ts.
  imports: [PrismaModule, SuperAdminModule],
  controllers: [Print3dController, SuperadminPrint3dController],
  providers: [Print3dService],
  exports: [Print3dService],
})
export class Print3dModule {}
