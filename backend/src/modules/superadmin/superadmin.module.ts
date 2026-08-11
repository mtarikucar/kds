import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";

// Controllers
import {
  SuperAdminAuthController,
  SuperAdminDashboardController,
  SuperAdminTenantsController,
  SuperAdminUsersController,
  SuperAdminAuditController,
  SuperAdminOutboxController,
} from "./controllers";

// Services
import {
  SuperAdminAuthService,
  SuperAdminAuditService,
  SuperAdminDashboardService,
  SuperAdminTenantsService,
  SuperAdminUsersService,
  SuperAdminOutboxService,
} from "./services";

import { SuperAdminGuard } from "./guards/superadmin.guard";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>("SUPERADMIN_JWT_SECRET");
        const refresh = configService.get<string>(
          "SUPERADMIN_JWT_REFRESH_SECRET",
        );
        const tenant = configService.get<string>("JWT_SECRET");
        if (!secret || !refresh) {
          throw new Error(
            "SUPERADMIN_JWT_SECRET and SUPERADMIN_JWT_REFRESH_SECRET must be configured",
          );
        }
        if (secret.length < 32 || refresh.length < 32) {
          throw new Error(
            "SUPERADMIN_JWT_SECRET / SUPERADMIN_JWT_REFRESH_SECRET must be at least 32 chars",
          );
        }
        if (secret === tenant || refresh === tenant) {
          throw new Error(
            "SUPERADMIN_JWT_SECRET must differ from the tenant JWT_SECRET",
          );
        }
        return {
          secret,
          signOptions: { expiresIn: "1h", algorithm: "HS256" },
          verifyOptions: { algorithms: ["HS256"] },
        };
      },
    }),
  ],
  controllers: [
    SuperAdminAuthController,
    SuperAdminDashboardController,
    SuperAdminTenantsController,
    SuperAdminUsersController,
    SuperAdminAuditController,
    SuperAdminOutboxController,
  ],
  providers: [
    SuperAdminAuthService,
    SuperAdminAuditService,
    SuperAdminDashboardService,
    SuperAdminTenantsService,
    SuperAdminUsersService,
    SuperAdminOutboxService,
    SuperAdminGuard,
  ],
  exports: [
    SuperAdminAuthService,
    SuperAdminAuditService,
    SuperAdminUsersService,
    // Exported so feature modules (marketplace, hardware catalog) can
    // protect their super-admin controllers with the same guard, rather
    // than each one redefining its own. The guard is stateless.
    SuperAdminGuard,
    // Re-exported so importers inherit the configured JwtService.
    // SuperAdminGuard's constructor takes JwtService; without this
    // re-export, NestJS fails to resolve the guard's dependencies in the
    // importing module's DI context with:
    //   "Nest can't resolve dependencies of the SuperAdminGuard
    //    (Reflector, ?, ConfigService, PrismaService)"
    // Exporting the JwtModule (which is registered with the
    // SUPERADMIN_JWT_SECRET above) propagates JwtService to importers.
    JwtModule,
  ],
})
export class SuperAdminModule {}
