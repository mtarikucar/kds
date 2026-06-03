import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { PublicStatsController } from "./public-stats.controller";
import { PublicStatsService } from "./public-stats.service";
import { GeolocationService } from "./geolocation.service";
// SuperAdminModule re-exports SuperAdminGuard (and the JwtModule
// configured with SUPERADMIN_JWT_SECRET) so the iter-51 review-
// moderation endpoints can verify superadmin tokens.
import { SuperAdminModule } from "../superadmin/superadmin.module";

@Module({
  imports: [PrismaModule, SuperAdminModule],
  controllers: [PublicStatsController],
  providers: [PublicStatsService, GeolocationService],
  exports: [PublicStatsService, GeolocationService],
})
export class PublicStatsModule {}
