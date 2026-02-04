import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Controllers
import {
  SuperAdminAuthController,
  SuperAdminDashboardController,
  SuperAdminTenantsController,
  SuperAdminUsersController,
  SuperAdminSubscriptionsController,
  SuperAdminAuditController,
} from './controllers';

// Services
import {
  SuperAdminAuthService,
  SuperAdminAuditService,
  SuperAdminDashboardService,
  SuperAdminTenantsService,
  SuperAdminUsersService,
  SuperAdminSubscriptionsService,
} from './services';

// Guards & Strategies
import { SuperAdminGuard } from './guards/superadmin.guard';
import { SuperAdminJwtStrategy } from './strategies/superadmin-jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('SUPERADMIN_JWT_SECRET'),
        signOptions: {
          expiresIn: '1h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    SuperAdminAuthController,
    SuperAdminDashboardController,
    SuperAdminTenantsController,
    SuperAdminUsersController,
    SuperAdminSubscriptionsController,
    SuperAdminAuditController,
  ],
  providers: [
    // Services
    SuperAdminAuthService,
    SuperAdminAuditService,
    SuperAdminDashboardService,
    SuperAdminTenantsService,
    SuperAdminUsersService,
    SuperAdminSubscriptionsService,
    // Guards & Strategies
    SuperAdminGuard,
    SuperAdminJwtStrategy,
  ],
  exports: [
    SuperAdminAuthService,
    SuperAdminAuditService,
    SuperAdminUsersService,
  ],
})
export class SuperAdminModule {}
