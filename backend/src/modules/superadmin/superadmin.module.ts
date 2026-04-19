import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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

import { SuperAdminGuard } from './guards/superadmin.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('SUPERADMIN_JWT_SECRET');
        const refresh = configService.get<string>('SUPERADMIN_JWT_REFRESH_SECRET');
        const tenant = configService.get<string>('JWT_SECRET');
        if (!secret || !refresh) {
          throw new Error(
            'SUPERADMIN_JWT_SECRET and SUPERADMIN_JWT_REFRESH_SECRET must be configured',
          );
        }
        if (secret.length < 32 || refresh.length < 32) {
          throw new Error(
            'SUPERADMIN_JWT_SECRET / SUPERADMIN_JWT_REFRESH_SECRET must be at least 32 chars',
          );
        }
        if (secret === tenant || refresh === tenant) {
          throw new Error(
            'SUPERADMIN_JWT_SECRET must differ from the tenant JWT_SECRET',
          );
        }
        return {
          secret,
          signOptions: { expiresIn: '1h', algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
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
    SuperAdminAuthService,
    SuperAdminAuditService,
    SuperAdminDashboardService,
    SuperAdminTenantsService,
    SuperAdminUsersService,
    SuperAdminSubscriptionsService,
    SuperAdminGuard,
  ],
  exports: [
    SuperAdminAuthService,
    SuperAdminAuditService,
    SuperAdminUsersService,
  ],
})
export class SuperAdminModule {}
