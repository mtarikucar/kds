import { Module } from "@nestjs/common";
import { DesktopAppService } from "./desktop-app.service";
import { DesktopAppController } from "./desktop-app.controller";
import { PrismaModule } from "../../prisma/prisma.module";
// iter-70 — desktop release admin endpoints are now SuperAdmin-only.
// SuperAdminModule re-exports SuperAdminGuard + the JwtModule configured
// with SUPERADMIN_JWT_SECRET. Same wiring shape iter-51 added to
// PublicStatsModule and iter-58 to ContactModule.
import { SuperAdminModule } from "../superadmin/superadmin.module";

@Module({
  imports: [PrismaModule, SuperAdminModule],
  controllers: [DesktopAppController],
  providers: [DesktopAppService],
  exports: [DesktopAppService],
})
export class DesktopAppModule {}
